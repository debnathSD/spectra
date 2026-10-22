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
  // What the project's package.json suggests: { framework, bundler, isSSR }. Only
  // a hint: the page itself decides (every adapter below waits for its own
  // framework to show up), so an Angular app is profiled as Angular even when
  // Spectra runs from another folder, a monorepo root or an editor.
  var SPECTRA_FRAMEWORK = typeof window.__SPECTRA_FRAMEWORK__ !== 'undefined' ? window.__SPECTRA_FRAMEWORK__ : null;

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

  // The box an element occupies, clipped to the viewport. A component host that
  // is an inline wrapper (Angular's <app-x>, Vue fragments) can have no box of
  // its own, so it falls back to the union of its children's boxes.
  function elementRect(el, vw, vh, depth) {
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    var r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      left = r.left;
      top = r.top;
      right = r.right;
      bottom = r.bottom;
    } else if ((depth || 0) < 3) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        var cr = elementRect(c, Infinity, Infinity, (depth || 0) + 1);
        if (!cr) continue;
        left = Math.min(left, cr[0]);
        top = Math.min(top, cr[1]);
        right = Math.max(right, cr[0] + cr[2]);
        bottom = Math.max(bottom, cr[1] + cr[3]);
      }
    }
    if (left === Infinity) return null;
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(vw, right);
    bottom = Math.min(vh, bottom);
    if (vw !== Infinity && (right - left < 16 || bottom - top < 16)) return null;
    return [Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top)];
  }

  // Angular (development mode) and Vue: find each component's element in the DOM.
  // Angular: ng.getComponent(host) is the component an element hosts. Vue 3: an
  // element's __vueParentComponent is the component that rendered it, and it is
  // that component's root element when the component's subTree points back at it.
  function frameworkLayout(byId, vw, vh) {
    var ng = window.ng;
    var useNg = probe.ngIds && ng && typeof ng.getComponent === 'function';
    var useVue = !!probe.vueIds;
    if (!useNg && !useVue) return;
    var els = document.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var id = undefined; // var is function-scoped: reset it for every element
      if (useNg) {
        var inst = null;
        try {
          inst = ng.getComponent(el);
        } catch (e) {}
        if (inst) id = probe.ngIds.get(inst.constructor);
      }
      if (id === undefined && useVue) {
        var vc = el.__vueParentComponent;
        if (vc && ((vc.subTree && vc.subTree.el === el) || (vc.vnode && vc.vnode.el === el))) id = probe.vueIds.get(vc.type);
      }
      if (id === undefined || !probe.stats[id]) continue;
      var rect = elementRect(el, vw, vh);
      if (rect) (byId[id] = byId[id] || []).push(rect);
    }
  }

  // Where every component that rendered during the recording sits in the viewport.
  probe.layout = function () {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var byId = {};
    try {
      frameworkLayout(byId, vw, vh);
    } catch (e) {}
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
    var fw =
      probe.frameworkName ||
      (probe.renderers > 0 ? 'react' : (SPECTRA_FRAMEWORK && SPECTRA_FRAMEWORK.framework) || '');
    return {
      react: probe.renderers > 0,
      framework: fw,
      detected: probe.renderers > 0 || !!probe.frameworkDetected,
      version: probe.reactVersion || probe.frameworkVersion || '',
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
  // React's hook is ignored by every other framework, so it is always there.
  try {
    installHook();
  } catch (e) {
    // Fail silently: probe should still collect vitals even if hooking fails.
  }

  // ------------------------------------------------ Vue adapter
  // Uses Vue's devtools global hook (dev builds). component:added / :updated
  // give per-component mount/update counts and names, and perf:start / perf:end
  // give real per-component render time. Component source files come straight
  // from the SFC compiler (type.__file), so no source-map step is needed.
  function installVueAdapter() {
    var vueIds = new Map();
    probe.vueIds = vueIds; // for the page map: component type -> stat id
    var nextId = 0;
    var perfStart = {};

    function getStat(instance) {
      if (!instance || !instance.type) return null;
      var type = instance.type;
      var id = vueIds.get(type);
      if (id === undefined) {
        id = nextId++;
        vueIds.set(type, id);
      }
      var stat = probe.stats[id];
      if (!stat) {
        stat = probe.stats[id] = {
          id: id,
          name: type.__name || type.name || type.__file && baseName(type.__file) || 'Anonymous',
          kind: 'vue',
          renders: 0,
          mounts: 0,
          wasted: 0,
          selfMs: 0,
          totalMs: 0,
          maxMs: 0,
          reasons: { props: 0, state: 0, hooks: 0, context: 0, parent: 0 },
          props: {},
          parents: {},
          file: type.__file || '',
        };
      }
      return stat;
    }

    function baseName(p) {
      var parts = String(p).split(/[\\/]/);
      return parts[parts.length - 1].replace(/\.\w+$/, '');
    }

    function recordParent(stat, instance) {
      var p = instance && instance.parent;
      var name = p && p.type && (p.type.__name || p.type.name);
      if (name) stat.parents[name] = (stat.parents[name] || 0) + 1;
    }

    function bumpCommit(dur) {
      probe.commits.push({ t: performance.now(), dur: dur || 0, rendered: 1, wasted: 0 });
      probe.commitCount = (probe.commitCount || 0) + 1;
    }

    function handle(evt, args) {
      if (evt === 'app:init') {
        probe.frameworkName = 'vue';
        probe.frameworkDetected = true;
        probe.frameworkVersion = args[1] || '';
        return;
      }
      if (!probe.active) return;
      if (evt === 'component:added') {
        var stat = getStat(args[3]);
        if (stat) {
          stat.mounts++;
          stat.renders++;
          recordParent(stat, args[3]);
          bumpCommit();
        }
        return;
      }
      if (evt === 'component:updated') {
        var s2 = getStat(args[3]);
        if (s2) {
          s2.renders++;
          recordParent(s2, args[3]);
          bumpCommit();
        }
        return;
      }
      if (evt === 'perf:start' || evt === 'perf:end') {
        var uid = args[1];
        var inst = args[2];
        var phase = args[3];
        var time = args[4];
        var key = uid + ':' + phase;
        if (evt === 'perf:start') {
          perfStart[key] = time;
          return;
        }
        var start = perfStart[key];
        if (start === undefined) return;
        delete perfStart[key];
        var dur = Math.max(0, time - start);
        var st = getStat(inst);
        if (!st) return;
        if (phase === 'render') {
          st.selfMs += dur;
          st.totalMs += dur;
          if (dur > st.maxMs) st.maxMs = dur;
          probe.sawTimings = true;
        } else if (phase === 'patch') {
          st.totalMs += dur;
        }
      }
    }

    var existing = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
    var hook = existing || {};
    hook.enabled = true;
    hook.apps = hook.apps || [];
    hook.store = hook.store || {};
    var prevEmit = typeof hook.emit === 'function' ? hook.emit.bind(hook) : null;
    hook.on = hook.on || function () {};
    hook.once = hook.once || function () {};
    hook.off = hook.off || function () {};
    hook.emit = function (evt) {
      try {
        handle(evt, Array.prototype.slice.call(arguments, 1));
      } catch (e) {}
      if (prevEmit) try { prevEmit.apply(null, arguments); } catch (e) {}
    };
    window.__VUE_DEVTOOLS_GLOBAL_HOOK__ = hook;
  }

  // ------------------------------------------------ Angular adapter
  // Uses Angular's dev-mode framework profiler (window.ng.ɵsetProfiler, present
  // when ngDevMode is on). Component change-detection fires paired start/end
  // events (2/3) carrying the component instance; a nesting stack turns those
  // into per-component render counts and self time (dur minus children), just
  // like React/Vue. The ng global appears only after bootstrap, so we poll.
  function installAngularAdapter() {
    var ngIds = new Map();
    probe.ngIds = ngIds; // for the page map: component class -> stat id
    var nextId = 100000; // keep clear of other adapters' id space
    var stack = [];

    function clean(n) {
      return (n || '').replace(/^_+/, '');
    }
    function isComponent(instance) {
      try {
        var ctor = instance && instance.constructor;
        if (!ctor) return false;
        return !!ctor['ɵcmp'] || /Component$/.test(ctor.name || '');
      } catch (e) {
        return false;
      }
    }
    function getStat(ctor, name) {
      var id = ngIds.get(ctor);
      if (id === undefined) {
        id = nextId++;
        ngIds.set(ctor, id);
      }
      var stat = probe.stats[id];
      if (!stat) {
        stat = probe.stats[id] = {
          id: id,
          name: name,
          kind: 'angular',
          renders: 0,
          mounts: 0,
          wasted: 0,
          selfMs: 0,
          totalMs: 0,
          maxMs: 0,
          reasons: { props: 0, state: 0, hooks: 0, context: 0, parent: 0 },
          props: {},
          parents: {},
          file: '',
        };
      }
      return stat;
    }
    function onEvent(event, instance) {
      if (!probe.active) return;
      if (event === 2) {
        // Component change-detection start. Push a frame (null for non-component
        // instances like structural-directive contexts) to keep the stack balanced.
        if (!isComponent(instance)) {
          stack.push(null);
          return;
        }
        if (stack.length === 0) probe.commitCount = (probe.commitCount || 0) + 1;
        stack.push({
          ctor: instance.constructor,
          name: clean(instance.constructor.name),
          start: performance.now(),
          child: 0,
        });
      } else if (event === 3) {
        var f = stack.pop();
        if (!f) return;
        var dur = performance.now() - f.start;
        var self = dur - f.child;
        if (self < 0) self = 0;
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i]) {
            stack[i].child += dur;
            break;
          }
        }
        var stat = getStat(f.ctor, f.name);
        stat.renders++;
        stat.selfMs += self;
        stat.totalMs += dur;
        if (self > stat.maxMs) stat.maxMs = self;
        probe.sawTimings = true;
      }
    }
    function register() {
      try {
        var ng = window.ng;
        if (ng && typeof ng['ɵsetProfiler'] === 'function') {
          ng['ɵsetProfiler'](function (event, instance) {
            try {
              onEvent(event, instance);
            } catch (e) {}
          });
          probe.frameworkName = 'angular';
          probe.frameworkDetected = true;
          probe.frameworkVersion =
            (window.ng && window.ng.ɵgetInjectorMetadata ? '' : '') || probe.frameworkVersion;
          return true;
        }
      } catch (e) {}
      return false;
    }
    if (!register()) {
      // poll for up to 30 s, and stop as soon as another framework shows up
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (register() || probe.renderers > 0 || probe.frameworkName === 'vue' || tries > 300) clearInterval(iv);
      }, 100);
    }
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

  // Vue and Angular too, whatever the hint says: each wakes up only for its own app
  try {
    installVueAdapter();
  } catch (e) {}
  try {
    installAngularAdapter();
  } catch (e) {}
  try {
    var fwHint = SPECTRA_FRAMEWORK && SPECTRA_FRAMEWORK.framework;
    if (fwHint === 'svelte') installFrameworkProbes(); // svelte: heuristic for now
  } catch (e) {}
  installObservers();
})();
