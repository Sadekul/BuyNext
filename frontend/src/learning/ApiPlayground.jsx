import { useState } from 'react'
import Button from '../components/ui/Button'
import { cn } from '../utils/classNames'
import { HTTP_EXAMPLES, sendTimed, sendWithAxios, sendWithFetch } from './httpExamples'
import './ApiPlayground.css'

const CLIENTS = {
  fetch: { label: 'fetch()', send: sendWithFetch },
  axios: { label: 'Axios', send: sendWithAxios },
}

/*
 * LEARNING EXAMPLE — send real HTTP requests and inspect the responses.
 * Requests here are event-driven (they run on click), not effect-driven.
 * Open DevTools → Network to watch each request and response.
 */
function ApiPlayground() {
  const [clientKey, setClientKey] = useState('fetch')
  const [pendingId, setPendingId] = useState(null)
  const [result, setResult] = useState(null)

  async function handleSend(example) {
    setPendingId(example.id)
    const client = CLIENTS[clientKey]

    try {
      const { status, data, ms } = await sendTimed(client.send, example)
      setResult({ example, client: client.label, status, data, ms })
    } catch (error) {
      setResult({ example, client: client.label, status: 0, data: { error: error.message }, ms: null })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="api-playground">
      <p className="api-playground__note" role="note">
        DummyJSON is a test API: POST, PUT, PATCH, and DELETE return realistic responses, but{' '}
        <strong>nothing is saved</strong>. Product #1 will look unchanged on the next GET.
      </p>

      <fieldset className="api-playground__clients">
        <legend>HTTP client</legend>
        {Object.entries(CLIENTS).map(([key, client]) => (
          <label key={key}>
            <input
              type="radio"
              name="http-client"
              value={key}
              checked={clientKey === key}
              onChange={() => setClientKey(key)}
            />
            {client.label}
          </label>
        ))}
      </fieldset>

      <ul className="api-playground__list">
        {HTTP_EXAMPLES.map((example) => (
          <li key={example.id} className="api-playground__item">
            <code className={cn('api-playground__method', `api-playground__method--${example.method.toLowerCase()}`)}>
              {example.method}
            </code>
            <div className="api-playground__details">
              <code>{example.path}</code>
              <span>{example.description}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => handleSend(example)} disabled={pendingId !== null}>
              {pendingId === example.id ? 'Sending…' : 'Send'}
            </Button>
          </li>
        ))}
      </ul>

      {result && (
        <div className="api-playground__result" aria-live="polite">
          <p className="api-playground__status">
            <strong>
              {result.example.method} {result.example.path}
            </strong>{' '}
            via {result.client} →{' '}
            <span className={result.status >= 200 && result.status < 300 ? 'is-success' : 'is-error'}>
              {result.status || 'No response'}
            </span>
            {result.ms !== null && ` in ${result.ms} ms`}
          </p>
          {result.example.body && (
            <>
              <p className="api-playground__label">Request body</p>
              <pre>{JSON.stringify(result.example.body, null, 2)}</pre>
            </>
          )}
          <p className="api-playground__label">Response body</p>
          <pre tabIndex={0}>{JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

export default ApiPlayground
