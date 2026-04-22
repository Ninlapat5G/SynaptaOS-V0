import { Component } from 'react'
import Icon from './ui/Icon'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(err) {
    return { error: err }
  }

  componentDidCatch(err, info) {
    console.error('[ErrorBoundary]', err, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sh-error-fallback">
          <Icon name="alert" size={22} />
          <span>เกิดข้อผิดพลาดในส่วนนี้</span>
          <p className="mono" style={{ fontSize: 11, color: 'var(--ink-xdim)', maxWidth: 320, textAlign: 'center' }}>
            {this.state.error.message}
          </p>
          <button
            className="sh-btn-ghost"
            onClick={() => this.setState({ error: null })}
          >
            ลองใหม่
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
