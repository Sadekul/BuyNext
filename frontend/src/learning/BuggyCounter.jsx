import { useState } from 'react'
import Button from '../components/ui/Button'

/*
 * LEARNING EXAMPLE — throws during render when the count reaches 3, so you
 * can watch an ErrorBoundary catch it. (Throwing inside the click handler
 * would NOT be caught: boundaries only catch rendering errors.)
 */
function BuggyCounter() {
  const [count, setCount] = useState(0)
  if (count === 3) throw new Error('BuggyCounter crashed at 3')

  return (
    <Button variant="outline" onClick={() => setCount((value) => value + 1)}>
      Clicked {count} {count === 1 ? 'time' : 'times'} (crashes at 3)
    </Button>
  )
}

export default BuggyCounter
