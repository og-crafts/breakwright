import '@fontsource-variable/manrope'
import '../tokens.css'
import '../../kit/ui/kit.css'
import './app.css'
import './setup'
import { applyTheme, savedTheme } from '../../kit/ui/theme'
import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
class Guard extends Component<{ children: ReactNode }, { e: Error | null }> {
  state = { e: null as Error | null }
  static getDerivedStateFromError(e: Error) { return { e } }
  render() { return this.state.e ? <main className="home stack"><h1>This screen stopped working</h1><p>Your files are safe: everything you saved is on disk.</p><pre>{this.state.e.message}</pre><div><button className="main" onClick={() => location.reload()}>Reload</button></div></main> : this.props.children }
}
applyTheme(savedTheme())
createRoot(document.getElementById('root')!).render(<Guard><App /></Guard>)
