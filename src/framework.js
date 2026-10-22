// What to call the component framework a page or report uses. Spectra is not
// tied to React: Vue and Angular get the same component-level data, and any
// other app still gets files and functions, so labels name the framework that
// was actually seen, or stay neutral ("components").
export const FRAMEWORK_NAMES = { react: 'React', next: 'Next.js', vue: 'Vue', angular: 'Angular', svelte: 'Svelte' };

/** A framework id ('react', 'vue', …) as a display name; '' when unknown. */
export const frameworkName = id => FRAMEWORK_NAMES[id] || '';

/** The framework a report's component data came from, as a display name ('' when none). */
export const reportFramework = report =>
  report?.react?.detected ? frameworkName(report.react.framework || 'react') || 'React' : '';
