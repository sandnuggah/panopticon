import { Button } from 'konsta/react'
import { WelcomeScene } from './WelcomeScene'

/** One thing the map screen waits for, and when it was done (ms since the page started loading). */
export type LoadingStep = { label: string; doneAt: number | undefined }

type Props = {
  steps: LoadingStep[]
  /** Fading out, once the map is ready. */
  leaving: boolean
  /** Traccar couldn't be reached: say so, with a way to try again. */
  failed: boolean
  onRetry: () => void
}

/**
 * What the map screen shows while it loads, from the first moment (the server sends it before
 * Traccar has answered): the front page's paper map, a progress bar, and each step with when it was
 * done, so a slow load shows where the time goes. The bar's width is a class per step, not a style:
 * the Content-Security-Policy blocks style attributes in the server-rendered page.
 */
export function LoadingScreen({ steps, leaving, failed, onRetry }: Props) {
  const done = steps.filter((step) => step.doneAt !== undefined).length
  const current = steps.findIndex((step) => step.doneAt === undefined)
  return (
    <div
      className={`loading-screen fixed inset-0 z-[100] grid place-items-center overflow-auto ios:bg-ios-light-surface ios:dark:bg-ios-dark-surface material:bg-md-light-surface material:dark:bg-md-dark-surface ${leaving ? 'loading-screen-leaving' : ''}`}
      aria-busy={!leaving}
    >
      <div className="w-full max-w-xs px-6 py-10">
        <div className="mx-auto w-52">
          <WelcomeScene />
        </div>
        <p className="paper-title pt-4 text-center text-[calc(1rem+16px)] leading-tight" aria-hidden="true">
          Panopticon
        </p>
        <div
          className="loading-bar mt-6"
          role="progressbar"
          aria-label="Loading the map"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
        >
          <div className={`loading-bar-fill loading-bar-${done}-of-${steps.length}`} />
        </div>
        <ol className="mt-5 flex flex-col gap-2.5 text-[0.9375rem]">
          {steps.map((step, index) => (
            <li key={index} className={`flex items-center gap-3 ${step.doneAt === undefined && index !== current ? 'opacity-45' : ''}`}>
              <StepMark state={step.doneAt !== undefined ? 'done' : index === current && !failed ? 'busy' : 'waiting'} />
              <span className="flex-1">{step.label}</span>
              {step.doneAt !== undefined && <span className="tabular-nums opacity-55">{(step.doneAt / 1000).toFixed(1)} s</span>}
            </li>
          ))}
        </ol>
        {failed && (
          <div className="mt-6 text-center" role="alert">
            <p className="pb-3 text-[0.9375rem]">Couldn't reach Traccar.</p>
            <Button rounded onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function StepMark({ state }: { state: 'done' | 'busy' | 'waiting' }) {
  if (state === 'done') {
    return (
      <svg className="size-5 shrink-0 text-primary" viewBox="0 0 20 20" aria-label="Done" role="img">
        <path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (state === 'busy') return <span className="loading-spinner size-5 shrink-0" role="img" aria-label="Loading" />
  return (
    <span className="grid size-5 shrink-0 place-items-center" aria-label="Waiting" role="img">
      <span className="size-1.5 rounded-full bg-current opacity-50" />
    </span>
  )
}
