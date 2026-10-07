// Deliberately slow helpers.
export function burn(ms) {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
}

export function thrashLayout(container) {
  const rows = container.querySelectorAll('.row');
  let total = 0;
  rows.forEach(row => {
    row.style.paddingLeft = `${Math.random() * 10}px`; // write
    total += row.offsetHeight; // read -> forces layout every iteration
  });
  return total;
}

// What a reviewer would want to see: all reads first, then all writes.
export function batchedLayout(container) {
  const rows = [...container.querySelectorAll('.row')];
  const heights = rows.map(row => row.offsetHeight);
  rows.forEach(row => {
    row.style.paddingLeft = `${Math.random() * 10}px`;
  });
  return heights.reduce((sum, h) => sum + h, 0);
}
