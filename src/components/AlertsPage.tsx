import { useEffect, useState, type ReactNode } from 'react'
import { BlockFooter, BlockTitle, List, ListButton, ListItem, Toggle } from 'konsta/react'
import type { AlertRule } from '../lib/alerts'
import { editErrorMessage } from '../lib/editErrors'
import { usePhonePush } from '../lib/usePhonePush'
import { getAlertSetup, savePhoneAlertChoices, sendPhoneTestAlert } from '../server/alerts.functions'
import type { AlertSetup } from '../server/alerts.server'
import type { PushTarget } from '../server/webPush.server'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }

/**
 * Settings → Alerts: notifications on this device when an asset leaves or arrives at one of its
 * places, or its tracker goes offline, also while Panopticon is closed. Each phone chooses its own
 * (see alerts.server.ts). Turning them on asks for permission, which browsers only do after a tap.
 */
export function AlertsPage({ listColors }: { listColors?: { strongBgIos: string } }) {
  const { state: push, turnOn, turnOff } = usePhonePush()
  const [setup, setSetup] = useState<AlertSetup>()
  const [failed, setFailed] = useState(false)
  const [rules, setRules] = useState<Record<number, AlertRule[]>>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const endpoint = push.kind === 'on' ? push.target.endpoint : null

  useEffect(() => {
    if (push.kind === 'checking') return
    let cancelled = false
    getAlertSetup({ data: endpoint })
      .then((result) => {
        if (cancelled) return
        setSetup(result)
        setRules(Object.fromEntries(result.assets.map((asset) => [asset.id, asset.rules])))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [push.kind, endpoint])

  async function save(target: PushTarget, next: Record<number, AlertRule[]>, done?: string): Promise<boolean> {
    setStatus({ kind: 'busy' })
    try {
      const result = await savePhoneAlertChoices({
        data: {
          target,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: navigator.language,
          rules: next,
        },
      })
      if (!result.ok) {
        setStatus({ kind: 'error', message: editErrorMessage(result.error) })
        return false
      }
      setStatus(done ? { kind: 'done', message: done } : { kind: 'idle' })
      return true
    } catch {
      setStatus({ kind: 'error', message: 'Something went wrong. Try again.' })
      return false
    }
  }

  function toggle(assetId: number, rule: AlertRule) {
    if (push.kind !== 'on') return
    const current = rules[assetId] ?? []
    const next = { ...rules, [assetId]: current.includes(rule) ? current.filter((other) => other !== rule) : [...current, rule] }
    const previous = rules
    setRules(next)
    void save(push.target, next).then((ok) => {
      if (!ok) setRules(previous)
    })
  }

  async function onTurnOn() {
    if (!setup) return
    setStatus({ kind: 'busy' })
    const target = await turnOn(setup.vapidPublicKey)
    setStatus(target ? { kind: 'idle' } : { kind: 'error', message: "Notifications weren't allowed." })
  }

  async function onTurnOff() {
    if (push.kind !== 'on') return
    if (await save(push.target, {})) {
      await turnOff()
      setRules({})
    }
  }

  async function onTest() {
    if (push.kind !== 'on') return
    setStatus({ kind: 'busy' })
    try {
      const result = await sendPhoneTestAlert({ data: { target: push.target } })
      setStatus(
        result === 'sent'
          ? { kind: 'done', message: 'Sent. It should show in a moment.' }
          : {
              kind: 'error',
              message:
                result === 'gone' ? 'This device no longer accepts alerts. Turn them off and on again.' : "Couldn't send it. Try again.",
            },
      )
    } catch {
      setStatus({ kind: 'error', message: "Couldn't send it. Try again." })
    }
  }

  if (!setup || push.kind === 'checking') {
    return (
      <List strong inset colors={listColors}>
        <ListItem title={failed ? "Couldn't load alerts. Try again." : 'Loading…'} />
      </List>
    )
  }

  if (!setup.available) {
    return (
      <Note>
        Alerts aren't set up on this server yet. Whoever runs it can turn them on: Traccar forwards its events to Panopticon, which sends
        the alerts (see the README's Alerts section).
      </Note>
    )
  }

  const busy = status.kind === 'busy'
  return (
    <>
      {push.kind === 'unsupported' && <Note>This browser can't show notifications.</Note>}
      {push.kind === 'install' && (
        <Note>
          On iPhone and iPad, alerts work in the Home Screen app. In Safari, tap Share, then Add to Home Screen, and open Panopticon from
          there.
        </Note>
      )}
      {push.kind === 'denied' && <Note>Notifications are off for Panopticon. Turn them on in the device's or browser's settings.</Note>}
      {push.kind === 'off' && (
        <>
          <List strong inset colors={listColors}>
            <ListButton onClick={() => void onTurnOn()} className={busy || !setup.canEdit ? 'pointer-events-none opacity-50' : ''}>
              Turn on alerts on this device
            </ListButton>
          </List>
          <BlockFooter>
            Get a notification when an asset leaves or arrives at one of its places, or its tracker goes offline, also while Panopticon is
            closed. You choose which on each device.
          </BlockFooter>
        </>
      )}

      {push.kind === 'on' &&
        setup.assets.map((asset) => {
          const chosen = rules[asset.id] ?? []
          const row = (rule: AlertRule, title: string) => (
            <ListItem
              key={rule}
              title={title}
              after={
                <Toggle
                  checked={chosen.includes(rule)}
                  disabled={busy || !setup.canEdit}
                  aria-label={`${asset.name}: ${title}`}
                  onChange={() => toggle(asset.id, rule)}
                />
              }
            />
          )
          return (
            <div key={asset.id}>
              <BlockTitle>{asset.name}</BlockTitle>
              <List strong inset colors={listColors}>
                {asset.places.flatMap((place) => [
                  row(`leave:${place.id}`, `Leaves ${place.name}`),
                  row(`arrive:${place.id}`, `Arrives at ${place.name}`),
                ])}
                {row('offline', 'Tracker goes offline')}
              </List>
              {asset.places.length === 0 && (
                <BlockFooter>Add places in Settings → Places to hear when {asset.name} leaves or arrives.</BlockFooter>
              )}
            </div>
          )
        })}

      {push.kind === 'on' && (
        <>
          <List strong inset colors={listColors}>
            <ListButton onClick={() => void onTest()} className={busy ? 'pointer-events-none opacity-50' : ''}>
              Send a test alert
            </ListButton>
            <ListButton
              colors={{ textIos: 'text-red-500', textMaterial: 'text-red-500' }}
              onClick={() => void onTurnOff()}
              className={busy || !setup.canEdit ? 'pointer-events-none opacity-50' : ''}
            >
              Turn off alerts on this device
            </ListButton>
          </List>
          <BlockFooter>
            Alerts come from Panopticon's server when Traccar reports the event, also while the app is closed. They're kept with each asset
            in Traccar, sealed.
          </BlockFooter>
        </>
      )}

      {!setup.canEdit && (
        <Note>Your Traccar account can't change assets, which alerts are kept with. An administrator can allow it in Traccar.</Note>
      )}
      {status.kind === 'error' && (
        <p className="px-8 pb-4 text-sm text-red-500" role="alert">
          {status.message}
        </p>
      )}
      {status.kind === 'done' && (
        <p className="px-8 pb-4 text-sm opacity-60" role="status">
          {status.message}
        </p>
      )}
    </>
  )
}

/** A message on its own: Konsta's BlockFooter pulls itself up to the list above, and with none, out of sight. */
function Note({ children }: { children: ReactNode }) {
  return <p className="px-8 pb-4 pt-2 text-sm opacity-70">{children}</p>
}
