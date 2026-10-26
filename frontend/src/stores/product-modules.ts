import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/client';
import { moduleForPage } from '@/utils/product-modules';
interface ModuleState {
  available: boolean;
  installed?: boolean;
  enabled?: boolean;
  licensed?: boolean;
}
export const useProductModulesStore = defineStore('product-modules', () => {
  const modules = ref<Record<string, ModuleState>>({
      omni: { available: true },
    }),
    loaded = ref(false),
    edition = ref('community');
  let pending: Promise<void> | undefined;
  let generation = 0;
  function enabled(id: string) {
    return (
      id === 'omni' || Boolean(loaded.value && modules.value[id]?.available)
    );
  }
  function canVisit(path: string) {
    const id = moduleForPage(path);
    return !id || enabled(id);
  }
  async function refresh() {
    if (pending) return pending;
    const epoch = generation;
    const run = (async () => {
      try {
        const { data } = await api.get('/api/product-modules');
        if (epoch !== generation) return;
        modules.value = data.data?.modules || { omni: { available: true } };
        edition.value = data.data?.edition || 'community';
        loaded.value = true;
      } catch {
        if (epoch !== generation) return;
        modules.value = { omni: { available: true } };
        edition.value = 'community';
        loaded.value = false;
      }
    })();
    pending = run;
    try {
      await run;
    } finally {
      if (pending === run) pending = undefined;
    }
  }
  function reset() {
    generation++;
    pending = undefined;
    modules.value = { omni: { available: true } };
    edition.value = 'community';
    loaded.value = false;
  }
  return {
    modules,
    loaded,
    edition,
    enabled,
    canVisit,
    refresh,
    reset,
  };
});
