import { createRoot } from 'react-dom/client'
import { AgentVisualizer } from './components/agent-visualizer'
import './styles.css'

// Web UI entry — connects to the agent-flow-claude server via SSE (see hooks/use-event-stream.ts)
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')
const root = createRoot(rootElement)
root.render(<AgentVisualizer />)
