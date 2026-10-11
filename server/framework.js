import fs from 'node:fs';
import path from 'node:path';

function readPkg(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg;
  } catch {
    return null;
  }
}

export function detectFramework(root) {
  const pkg = readPkg(root) || {};
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  const files = new Set(fs.readdirSync(root).map(f => f.toLowerCase()));

  const result = {
    framework: 'unknown',
    bundler: 'unknown',
    isSSR: false,
    hints: [],
  };

  if (deps['next'] || files.has('next.config.js') || fs.existsSync(path.join(root, 'pages'))) {
    result.framework = 'next';
    result.bundler = 'webpack';
    result.isSSR = true;
    result.hints.push('next');
    return result;
  }

  if (deps['react'] && deps['react-dom']) {
    result.framework = 'react';
    result.hints.push('react');
  }
  if (deps['vue'] || files.has('vue.config.js')) {
    result.framework = 'vue';
    result.hints.push('vue');
  }
  if (deps['svelte'] || files.has('svelte.config.js')) {
    result.framework = 'svelte';
    result.hints.push('svelte');
  }
  if (deps['@angular/core'] || files.has('angular.json')) {
    result.framework = 'angular';
    result.hints.push('angular');
  }

  if (files.has('vite.config.js') || files.has('vite.config.ts') || deps['vite']) {
    result.bundler = 'vite';
    result.hints.push('vite');
  }
  if (files.has('webpack.config.js') || deps['webpack']) {
    result.bundler = 'webpack';
    result.hints.push('webpack');
  }
  if (files.has('rollup.config.js') || deps['rollup']) {
    result.bundler = 'rollup';
    result.hints.push('rollup');
  }

  // Some frameworks bundle SSR runtimes but still have client bundles.
  if (result.framework === 'next') result.isSSR = true;

  return result;
}
