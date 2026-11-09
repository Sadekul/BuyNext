import { Component } from 'react'

/*
 * LEARNING EXAMPLE — lifecycle methods in a class component.
 * The app uses the hook version instead (hooks/useOnlineStatus.js).
 *
 * componentDidMount     ≈ useEffect(() => { … }, [])        — after the first render
 * componentDidUpdate    ≈ useEffect(() => { … }, [deps])    — after later renders
 * componentWillUnmount  ≈ the cleanup function returned by useEffect
 */
class OnlineStatusClass extends Component {
  state = { isOnline: navigator.onLine, changes: 0 }

  handleChange = () => this.setState({ isOnline: navigator.onLine })

  componentDidMount() {
    // Subscribe once the component is on the page.
    window.addEventListener('online', this.handleChange)
    window.addEventListener('offline', this.handleChange)
  }

  componentDidUpdate(prevProps, prevState) {
    // Runs after every update; compare with the previous state to react to changes only.
    if (prevState.isOnline !== this.state.isOnline) {
      this.setState((state) => ({ changes: state.changes + 1 }))
    }
  }

  componentWillUnmount() {
    // Always remove what componentDidMount added, or the listeners leak.
    window.removeEventListener('online', this.handleChange)
    window.removeEventListener('offline', this.handleChange)
  }

  render() {
    const { isOnline, changes } = this.state
    return (
      <p>
        {isOnline ? 'Online' : 'Offline'} · changed {changes} {changes === 1 ? 'time' : 'times'}
      </p>
    )
  }
}

export default OnlineStatusClass
