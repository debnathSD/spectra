<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
const now = ref(Date.now());
let t;
onMounted(() => { t = setInterval(() => { now.value = Date.now(); }, 100); });
onUnmounted(() => clearInterval(t));
// Deliberately expensive work on every render (Spectra should flag this).
const heavy = computed(() => {
  let s = 0;
  for (let i = 0; i < 900_000; i++) s += Math.sqrt((i * now.value) % 7);
  return Math.round(s);
});
</script>
<template><p>Clock: {{ now }} / {{ heavy }}</p></template>
