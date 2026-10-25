import { onBeforeUnmount, onMounted, ref } from 'vue'

export function useClock() {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  const refresh = () => { now.value = Date.now() }
  onMounted(() => {
    timer = setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', refresh)
  })
  return now
}
