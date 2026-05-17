import * as Sentry from '@sentry/react'
import { useEffect } from 'react'
import {
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from 'react-router-dom'

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: 'https://b20c8de998558deba505e22bb4525610@o4511359655673856.ingest.us.sentry.io/4511359656067072',
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        buttonLabel: 'Feedback',
        submitButtonLabel: 'Send feedback',
        formTitle: 'Share feedback',
      }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}
