// Phase 43: Module UI sandbox.
//
// Renders a module's frontend inside a `sandbox="allow-scripts"` iframe with
// NO `allow-same-origin`, so the module has zero DOM access to the host app.
// Communication is exclusively via postMessage. The bridge logic lives in
// src/lib/sdk-bridge.ts.

import { useEffect, useRef, useState } from 'react'
import { handleIncomingMessage } from '../lib/sdk-bridge'

export interface ModuleFrameProps {
  module_id: string
  /// Path to the module's entry HTML, relative to the install dir.
  /// Defaults to 'frontend/index.html'.
  entry_point?: string
  /// First-party trusted modules render React directly when trusted=true is
  /// set on the module_registry row. Untrusted always uses the iframe.
  trusted?: boolean
  height?: number | string
  width?: number | string
  /// Optional inline HTML for tests / first-party modules that ship inline
  /// markup instead of a separate file. When provided, used as the iframe
  /// `srcdoc` directly.
  srcdoc?: string
}

export function ModuleFrame({
  module_id,
  entry_point,
  trusted = false,
  height = '100%',
  width = '100%',
  srcdoc,
}: ModuleFrameProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (trusted) return // direct-render path doesn't use postMessage

    function onMessage(e: MessageEvent): void {
      // Reject any message that didn't come from this iframe.
      if (e.source !== iframeRef.current?.contentWindow) return
      handleIncomingMessage(e.data, module_id)
        .then((response) => {
          iframeRef.current?.contentWindow?.postMessage(response, '*')
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
        })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [module_id, trusted])

  if (trusted) {
    // Phase 43: trusted first-party modules render React directly. The
    // concrete React component is loaded by the host's module loader; here
    // we just render a slot. The kernel host wires the actual component.
    return (
      <div data-trusted-module={module_id} style={{ width, height }}>
        {/* Trusted module React tree mounts here */}
      </div>
    )
  }

  if (error) {
    return (
      <div role="alert" style={{ padding: 16, color: '#dc2626' }}>
        Module crashed: {error}
        <button onClick={() => setError(null)}>Retry</button>
      </div>
    )
  }

  // Inject MODULE_ID via window.__MODULE_ID__ before sdk.js loads.
  const bootstrapHtml = srcdoc ?? `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${module_id}</title>
    <link rel="stylesheet" href="/module-sdk/theme.css" />
    <script>window.__MODULE_ID__ = ${JSON.stringify(module_id)};</script>
  </head>
  <body>
    <div id="root">Loading ${entry_point ?? 'frontend/index.html'}...</div>
  </body>
</html>`

  return (
    <iframe
      ref={iframeRef}
      title={`module-${module_id}`}
      sandbox="allow-scripts"
      srcDoc={bootstrapHtml}
      style={{ width, height, border: 0 }}
    />
  )
}
