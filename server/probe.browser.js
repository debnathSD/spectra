/*
 * In-page probe, injected with Page.addScriptToEvaluateOnNewDocument so it
 * runs before any application code. It is plain ES5-ish browser code: no
 * imports, no build step.
 *
 * It collects what the trace cannot know:
 *   - React: per-component render counts, time, *why* each render happened
 *     and which props were recreated without changing (via the React DevTools
 *     global hook; React 16.9+ / 17 / 18 development builds).
 *   - Web vitals as the browser reported them: long tasks, long animation
 *     frames, layout shifts (with the shifting elements), slow interactions,
 *     LCP, FCP and resource timings.
 */
(function () {
  if (window.__PERF_PROBE__) return;
  // Runtime hint injected by the profiler: { framework, bundler, isSSR }
  var SPECTRA_FRAMEWORK = typeof window.__SPECTRA_FRAMEWORK__ !== 'undefined' ? window.__SPECTRA_FRAMEWORK__ : null;
  var WANT_REACT = !SPECTRA_FRAMEWORK || SPECTRA_FRAMEWORK.framework === 'react' || SPECTRA_FRAMEWORK.framework === 'unknown';

  var PERFORMED_WORK = 1;
  var TAG_FUNCTION = 0;
  var TAG_CLASS = 1;
  var TAG_FORWARD_REF = 11;
  var TAG_SIMPLE_MEMO = 15;
  var TAG_HOST_COMPONENT = 5;
  var TAG_HOST_PORTAL = 4;
  var MAX_COMMITS = 3000;
  var DEEP_COMPARE_LIMIT = 300;

  var probe = {
    active: false,
    startedAt: 0,
    renderers: 0,
    sawTimings: false,
    reactVersion: '',
    stats: {},
    typeFns: [],
    typeIds: new WeakMap(),
    commits: [],
    commitCount: 0,
    overheadMs: 0,
    roots: new Set(),
  };

  var vitals = {
    longtasks: [],
    loafs: [],
    shifts: [],
    events: [],
    lcp: null,
    fcp: null,
  };

  // ---------------------------------------------------------------- helpers

  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    for (
      var n = el, i = 0;
      n && n.nodeType === 1 && i < 4;
      n = n.parentElement, i++
    ) {
      var s = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(s + '#' + n.id);
        break;
      }
      var testId = n.getAttribute && n.getAttribute('data-test');
      if (testId) s += '[data-test="' + testId + '"]';
      else if (n.classList && n.classList.length) {
        s += '.' + Array.prototype.slice.call(n.classList, 0, 2).join('.');
      }
      parts.unshift(s);
    }
    return parts.join(' > ');
  }

  function looseEqual(a, b, depth) {
    if (a === b) return true;
    if (
      depth <= 0 ||
      !a ||
      !b ||
      typeof a !== 'object' ||
      typeof b !== 'object'
    )
      return false;
    if (a.$$typeof || b.$$typeof) return false;
    var ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length || ka.length > 50) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!looseEqual(a[ka[i]], b[ka[i]], depth - 1)) return false;
    }
    return true;
  }

  function sameFunctionSource(a, b) {
    try {
      return (
        a.length === b.length &&
        Function.prototype.toString.call(a) ===
          Function.prototype.toString.call(b)
      );
    } catch (e) {
      return false;
    }
  }

  function componentFn(fiber) {
    var t = fiber.type;
    if (!t) return null;
    if (typeof t === 'function') return t;
    return t.render || t.type || null; // forwardRef / memo wrappers
  }

  function displayName(fiber, fn) {
    var t = fiber.type;
    return (
      (t && t.displayName) ||
      (fn && (fn.displayName || fn.name)) ||
      (fiber.elementType && fiber.elementType.displayName) ||
      'Anonymous'
    );
  }

  function typeIdOf(fn) {
    var id = probe.typeIds.get(fn);
    if (id === undefined) {
      id = probe.typeFns.length;
      probe.typeFns.push(fn);
      probe.typeIds.set(fn, id);
    }
    return id;
  }

  // ------------------------------------------------- why did this render?

  function changedPropKeys(prev, next) {
    var keys = [];
    if (prev === next) return keys;
    if (!prev || !next) return ['(props)'];
    var seen = {};
    var k;
    for (k in next) {
      seen[k] = true;
      if (prev[k] !== next[k]) keys.push(k);
    }
    for (k in prev) if (!seen[k] && next[k] !== prev[k]) keys.push(k);
    return keys;
  }

  function hooksStateChanged(prev, next) {
    for (var a = prev, b = next; a && b; a = a.next, b = b.next) {
      // Only useState/useReducer hooks own a queue; memo/effect/ref hooks
      // change their memoizedState on every render and would be noise.
      if (b.queue && a.memoizedState !== b.memoizedState) return true;
    }
    return false;
  }

  function contextChanged(prevDeps, nextDeps) {
    var a = prevDeps && prevDeps.firstContext;
    var b = nextDeps && nextDeps.firstContext;
    while (a && b) {
      if (a.memoizedValue !== b.memoizedValue) return true;
      a = a.next;
      b = b.next;
    }
    return false;
  }

  function classifyPropChange(stat, key, prevValue, nextValue) {
    var rec =
      stat.props[key] ||
      (stat.props[key] = { n: 0, sampled: 0, fn: 0, obj: 0 });
    rec.n++;
    if (stat.renders > DEEP_COMPARE_LIMIT) return;
    rec.sampled++;
    if (typeof prevValue === 'function' && typeof nextValue === 'function') {
      if (sameFunctionSource(prevValue, nextValue)) rec.fn++;
    } else if (
      prevValue &&
      nextValue &&
      typeof prevValue === 'object' &&
      typeof nextValue === 'object'
    ) {
      if (looseEqual(prevValue, nextValue, 3)) rec.obj++;
    }
  }

  function childrenDuration(fiber) {
    var sum = 0;
    for (var c = fiber.child; c; c = c.sibling) sum += c.actualDuration || 0;
    return sum;
  }

  function record(fiber, alt, parentName, commit) {
    var fn = componentFn(fiber);
    if (!fn) return;
    var id = typeIdOf(fn);
    var stat = probe.stats[id];
    if (!stat) {
      stat = probe.stats[id] = {
        id: id,
        name: displayName(fiber, fn),
        kind: fiber.tag === TAG_CLASS ? 'class' : 'function',
        renders: 0,
        mounts: 0,
        wasted: 0,
        selfMs: 0,
        totalMs: 0,
        maxMs: 0,
        reasons: { props: 0, state: 0, hooks: 0, context: 0, parent: 0 },
        props: {},
        parents: {},
      };
    }
    stat.renders++;
    commit.rendered++;

    var total = fiber.actualDuration || 0;
    var self = Math.max(0, total - childrenDuration(fiber));
    stat.selfMs += self;
    stat.totalMs += total;
    if (self > stat.maxMs) stat.maxMs = self;
    if (parentName)
      stat.parents[parentName] = (stat.parents[parentName] || 0) + 1;

    if (!alt) {
      stat.mounts++;
      return;
    }
    var keys = changedPropKeys(alt.memoizedProps, fiber.memoizedProps);
    var stateChanged = false;
    var hooksChanged = false;
    if (fiber.tag === TAG_CLASS)
      stateChanged = alt.memoizedState !== fiber.memoizedState;
    else
      hooksChanged = hooksStateChanged(alt.memoizedState, fiber.memoizedState);
    var ctxChanged = contextChanged(alt.dependencies, fiber.dependencies);

    if (keys.length) {
      stat.reasons.props++;
      for (var i = 0; i < keys.length; i++) {
        classifyPropChange(
          stat,
          keys[i],
          alt.memoizedProps && alt.memoizedProps[keys[i]],
          fiber.memoizedProps && fiber.memoizedProps[keys[i]],
        );
      }
    }
    if (stateChanged) stat.reasons.state++;
    if (hooksChanged) stat.reasons.hooks++;
    if (ctxChanged) stat.reasons.context++;
    if (!keys.length && !stateChanged && !hooksChanged && !ctxChanged) {
      stat.wasted++;
      stat.reasons.parent++;
      commit.wasted++;
    }
  }

  function isComposite(tag) {
    return (
      tag === TAG_FUNCTION ||
      tag === TAG_CLASS ||
      tag === TAG_FORWARD_REF ||
      tag === TAG_SIMPLE_MEMO
    );
  }

  function walkCommit(rootFiber, commit) {
    var stack = [rootFiber, ''];
    while (stack.length) {
      var parentName = stack.pop();
      var fiber = stack.pop();
      var alt = fiber.alternate;
      var flags = fiber.flags !== undefined ? fiber.flags : fiber.effectTag;
      var name = parentName;
      if (isComposite(fiber.tag) && (!alt || flags & PERFORMED_WORK)) {
        record(fiber, alt, parentName, commit);
        name = displayName(fiber, componentFn(fiber));
      } else if (isComposite(fiber.tag)) {
        name = displayName(fiber, componentFn(fiber));
      }
      // A bailed-out subtree shares its child pointer with the previous tree.
      if (fiber.child && (!alt || fiber.child !== alt.child)) {
        for (var c = fiber.child; c; c = c.sibling) stack.push(c, name);
      }
    }
  }

  function onCommit(root) {
    probe.roots.add(root);
    // Only development/profiling builds of React maintain actualDuration.
    if (typeof (root.current && root.current.actualDuration) === 'number')
      probe.sawTimings = true;
    if (!probe.active) return;
    var t0 = performance.now();
    var commit = {
      t: t0,
      dur: (root.current && root.current.actualDuration) || 0,
      rendered: 0,
      wasted: 0,
    };
    try {
      walkCommit(root.current, commit);
    } catch (e) {
      probe.lastError = String(e && e.message);
    }
    probe.commitCount++;
    if (probe.commits.length < MAX_COMMITS) probe.commits.push(commit);
    probe.overheadMs += performance.now() - t0;
  }

  // ------------------------------------------------ DevTools global hook

  function installHook() {
    var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) {
      var nextId = 1;
      hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map(),
        supportsFiber: true,
        isDisabled: false,
        inject: function (renderer) {
          var id = nextId++;
          hook.renderers.set(id, renderer);
          return id;
        },
        onCommitFiberRoot: function () {},
        onCommitFiberUnmount: function () {},
        onScheduleFiberRoot: function () {},
        onPostCommitFiberRoot: function () {},
        checkDCE: function () {},
      };
    }
    var originalInject = hook.inject;
    hook.inject = function (renderer) {
      probe.renderers++;
      probe.reactVersion = (renderer && renderer.version) || probe.reactVersion;
      return originalInject.apply(this, arguments);
    };
    var originalCommit = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function (id, root) {
      onCommit(root);
      return originalCommit && originalCommit.apply(this, arguments);
    };
    if (hook.renderers && hook.renderers.size) probe.renderers = hook.renderers.size;
  }

  // ------------------------------------------------------------ vitals

  function observe(type, options, handler) {
    try {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
      var po = new PerformanceObserver(function (list) {
        list.getEntries().forEach(handler);
      });
      options.type = type;
      options.buffered = true;
      po.observe(options);
    } catch (e) {
      /* unsupported entry type */
    }
  }

  function installObservers() {
    observe('longtask', {}, function (e) {
      vitals.longtasks.push({ start: e.startTime, dur: e.duration });
    });
    observe('long-animation-frame', {}, function (e) {
      vitals.loafs.push({
        start: e.startTime,
        dur: e.duration,
        blocking: e.blockingDuration || 0,
        style: e.styleAndLayoutStart
          ? e.startTime + e.duration - e.styleAndLayoutStart
          : 0,
        scripts: (e.scripts || []).slice(0, 8).map(function (s) {
          return {
            url: s.sourceURL,
            fn: s.sourceFunctionName,
            pos: s.sourceCharPosition,
            invoker: s.invoker,
            type: s.invokerType,
            dur: s.duration,
            forced: s.forcedStyleAndLayoutDuration || 0,
          };
        }),
      });
    });
    observe('layout-shift', {}, function (e) {
      if (e.hadRecentInput) return;
      vitals.shifts.push({
        start: e.startTime,
        value: e.value,
        sources: (e.sources || []).slice(0, 4).map(function (s) {
          return selectorOf(s.node);
        }),
      });
    });
    observe('largest-contentful-paint', {}, function (e) {
      vitals.lcp = {
        start: e.startTime,
        size: e.size,
        el: selectorOf(e.element),
        url: e.url || '',
      };
    });
    observe('paint', {}, function (e) {
      if (e.name === 'first-contentful-paint') vitals.fcp = e.startTime;
    });
    observe('event', { durationThreshold: 40 }, function (e) {
      vitals.events.push({
        name: e.name,
        start: e.startTime,
        dur: e.duration,
        input: e.processingStart - e.startTime,
        processing: e.processingEnd - e.processingStart,
        present: e.startTime + e.duration - e.processingEnd,
        target: selectorOf(e.target),
        interaction: e.interactionId || 0,
      });
    });
  }

  // --------------------------------------------------------------- API

  probe.start = function () {
    probe.stats = {};
    probe.commits = [];
    probe.commitCount = 0;
    probe.overheadMs = 0;
    probe.startedAt = performance.now();
    probe.active = true;
    return probe.startedAt;
  };

  probe.stop = function () {
    probe.active = false;
  };

  // Outermost DOM nodes a component renders (stops at the first host element).
  function hostRect(fiber, vw, vh) {
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    var stack = [];
    for (var c = fiber.child; c; c = c.sibling) stack.push(c);
    while (stack.length) {
      var f = stack.pop();
      if (f.tag === TAG_HOST_COMPONENT) {
        var el = f.stateNode;
        if (!el || !el.getBoundingClientRect) continue;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      } else if (f.tag !== TAG_HOST_PORTAL) {
        for (var k = f.child; k; k = k.sibling) stack.push(k);
      }
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(vw, right);
    bottom = Math.min(vh, bottom);
    if (right - left < 16 || bottom - top < 16) return null;
    return [
      Math.round(left),
      Math.round(top),
      Math.round(right - left),
      Math.round(bottom - top),
    ];
  }

  // Where every component that rendered during the recording sits in the viewport.
  probe.layout = function () {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var byId = {};
    probe.roots.forEach(function (root) {
      var stack = [root.current];
      while (stack.length) {
        var f = stack.pop();
        if (isComposite(f.tag)) {
          var fn = componentFn(f);
          var id = fn ? probe.typeIds.get(fn) : undefined;
          if (id !== undefined && probe.stats[id]) {
            var rect = hostRect(f, vw, vh);
            if (rect) (byId[id] = byId[id] || []).push(rect);
          }
        }
        for (var c = f.child; c; c = c.sibling) stack.push(c);
      }
    });
    var entries = Object.keys(byId)
      .map(function (id) {
        var rects = byId[id]
          .sort(function (a, b) {
            return b[2] * b[3] - a[2] * a[3];
          })
          .slice(0, 6);
        return { id: Number(id), rects: rects, count: byId[id].length };
      })
      .sort(function (a, b) {
        return probe.stats[b.id].selfMs - probe.stats[a.id].selfMs;
      })
      .slice(0, 300);
    return {
      width: vw,
      height: vh,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      entries: entries,
    };
  };

  probe.info = function () {
    return {
      react: probe.renderers > 0,
      version: probe.reactVersion,
      active: probe.active,
      timings: probe.sawTimings,
    };
  };

  probe.snapshot = function () {
    var since = probe.startedAt;
    var inWindow = function (e) {
      return e.start >= since;
    };
    var resources = performance.getEntriesByType('resource').map(function (r) {
      return {
        url: r.name,
        type: r.initiatorType,
        start: r.startTime,
        dur: r.duration,
        transfer: r.transferSize,
        encoded: r.encodedBodySize,
        decoded: r.decodedBodySize,
        blocking: r.renderBlockingStatus || '',
      };
    });
    var nav = performance.getEntriesByType('navigation')[0];
    return {
      info: probe.info(),
      now: performance.now(),
      since: since,
      overheadMs: probe.overheadMs,
      commitCount: probe.commitCount,
      commits: probe.commits,
      components: Object.keys(probe.stats).map(function (k) {
        return probe.stats[k];
      }),
      vitals: {
        longtasks: vitals.longtasks.filter(inWindow),
        loafs: vitals.loafs.filter(inWindow),
        shifts: vitals.shifts.filter(inWindow),
        events: vitals.events.filter(inWindow),
        lcp: vitals.lcp,
        fcp: vitals.fcp,
      },
      resources: resources,
      navigation: nav
        ? {
            ttfb: nav.responseStart,
            domContentLoaded: nav.domContentLoadedEventEnd,
            load: nav.loadEventEnd,
          }
        : null,
    };
  };

  window.__PERF_PROBE__ = probe;
  // Only attempt to hook into React when the runtime hint allows it.
  try {
    if (WANT_REACT) installHook();
  } catch (e) {
    // Fail silently: probe should still collect vitals even if hooking fails.
  }

  // ------------------------------------------------ Framework fallbacks
  // Provide lightweight probes for Vue, Svelte and Angular when React is not detected.
  function installFrameworkProbes() {
    var fw = SPECTRA_FRAMEWORK && SPECTRA_FRAMEWORK.framework ? SPECTRA_FRAMEWORK.framework : null;
    if (!fw) return;

    // Shared storage on probe for framework-specific summaries
    probe.framework = probe.framework || {
      name: fw,
      detected: false,
      version: '',
      commits: [],
      components: [],
      commitCount: 0,
    };

    // MutationObserver-based heuristic for UI frameworks (Vue, Svelte): treat DOM updates as "commits".
    try {
      var mo = new MutationObserver(function (mutations) {
        if (!probe.active) return;
        var t = performance.now();
        var rendered = 0;
        var seen = new Set();
        for (var m of mutations) {
          rendered += (m.addedNodes && m.addedNodes.length) || 0;
          // detect Vue component instances on added nodes (Vue 2: __vue__, Vue 3: __vueParentComponent)
          var nodes = m.addedNodes || [];
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            try {
              if (n && n.__vue__) seen.add(n.__vue__);
              if (n && n.__vueParentComponent) seen.add(n.__vueParentComponent);
              // Svelte: look for nodes with attributes starting with 'data-svelte'
              if (n && n.attributes) {
                for (var j = 0; j < n.attributes.length; j++) {
                  var an = n.attributes[j].name || '';
                  if (an.indexOf('data-svelte') === 0) seen.add(an + (n.localName || ''));
                }
              }
            } catch (e) {}
          }
        }
        var commit = { t: t, dur: 0, rendered: rendered, components: seen.size };
        probe.commits.push(commit);
        probe.commitCount = (probe.commitCount || 0) + 1;
        probe.framework.detected = true;
        probe.framework.commitCount = probe.commitCount;
      });
      mo.observe(document, { childList: true, subtree: true });
    } catch (e) {
      // ignore
    }

    // Angular: if Zone.js is available, instrument Zone.run to measure change-detection durations
    try {
      if (fw === 'angular' && window.Zone && window.Zone.prototype && !window.__SPECTRA_ANGULAR_ZONE_PATCHED__) {
        window.__SPECTRA_ANGULAR_ZONE_PATCHED__ = true;
        var _origRun = window.Zone.prototype.run;
        window.Zone.prototype.run = function () {
          var start = performance.now();
          try {
            return _origRun.apply(this, arguments);
          } finally {
            try {
              if (probe.active) {
                var dur = performance.now() - start;
                probe.commits.push({ t: start, dur: dur, rendered: 0, components: 0 });
                probe.commitCount = (probe.commitCount || 0) + 1;
                probe.framework.detected = true;
                probe.framework.commitCount = probe.commitCount;
                probe.framework.version = window.Zone.version || probe.framework.version;
              }
            } catch (e) {}
          }
        };
      }
    } catch (e) {}

    // Next.js: treat as React unless React missing; try to detect Next router navigations for commits
    try {
      if (fw === 'next') {
        // Next is usually React-based; provide basic navigational commit hints
        if (window.next && window.next.router && window.next.router.events) {
          var ev = window.next.router.events;
          if (ev && ev.on) {
            ev.on('routeChangeComplete', function () {
              if (!probe.active) return;
              var t = performance.now();
              probe.commits.push({ t: t, dur: 0, rendered: 0, components: 0 });
              probe.commitCount = (probe.commitCount || 0) + 1;
              probe.framework.detected = true;
            });
          }
        }
      }
    } catch (e) {}
  }

  try {
    if (!WANT_REACT) installFrameworkProbes();
  } catch (e) {}
  installObservers();
})();
