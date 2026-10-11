<script setup>
import { ref } from 'vue';
import ItemRow from './components/ItemRow.vue';
import Clock from './components/Clock.vue';

const tick = ref(0);
const items = ref(Array.from({ length: 40 }, (_, i) => ({ id: i, label: 'Item ' + i })));
function bump() { tick.value++; }
</script>

<template>
  <main style="font-family: system-ui; padding: 20px;">
    <h1>Spectra Vue Demo</h1>
    <button id="bump" @click="bump">Bump ({{ tick }})</button>
    <Clock />
    <ul>
      <ItemRow v-for="it in items" :key="it.id" :item="it" />
    </ul>
  </main>
</template>
