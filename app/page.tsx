import ZenithApp from '@/components/ZenithApp'
import Landing from '@/components/Landing'

// Home: the globe app mounts immediately and initialises behind the Landing
// overlay, so it's fully loaded by the time the user clicks LAUNCH — which just
// fades the overlay away to reveal the already-rendered globe (smooth, no nav).
export default function Page() {
  return (
    <>
      <ZenithApp />
      <Landing />
    </>
  )
}
