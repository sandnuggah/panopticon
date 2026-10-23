import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BlockFooter, BlockTitle, List, ListButton, ListItem, Toggle } from 'konsta/react'
import type { AlertRule } from '../lib/alerts'
import { DEFAULT_WALK_RULE, hoursLabel, parseWalkRule, WALK_AFTER_MINUTES, walkRule, walkRuleOf, type WalkRule } from '../lib/walkReminder'
import { editErrorMessage } from '../lib/editErrors'
import { usePhonePush } from '../lib/usePhonePush'
import { getAlertSetup, savePhoneAlertChoices, sendPhoneTestAlert } from '../server/alerts.functions'
import type { AlertSetup } from '../server/alerts.server'
import type { PushTarget } from '../server/webPush.server'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string }

/**
 * Alerts, on an asset's page: notifications on this device when it leaves or arrives at one of its
 * places, its tracker goes offline, or it hasn't been out for a while, also while Panopticon is
 * closed. Each phone chooses its own (see alerts.server.ts), for all assets in one go, so this keeps
 * the phone's choices for all of them and shows this asset's. Turning them on asks for permission,
 * which browsers only do after a tap; it, the test alert and turning them off are for the device.
 */
export function AssetAlerts({ assetId, listColors }: { assetId: number; listColors?: { strongBgIos: string } }) {
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
    const current = rules[assetId] ?? []
    change(assetId, current.includes(rule) ? current.filter((other) => other !== rule) : [...current, rule])
  }

  /** The walk reminder on (with these settings) or off (undefined). */
  function setWalk(assetId: number, walk: WalkRule | undefined) {
    const current = (rules[assetId] ?? []).filter((rule) => !rule.startsWith('walk:'))
    change(assetId, walk ? [...current, walkRule(walk)] : current)
  }

  function change(assetId: number, list: AlertRule[]) {
    if (push.kind !== 'on') return
    const next = { ...rules, [assetId]: list }
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
      <>
        <BlockTitle>Alerts</BlockTitle>
        <List strong inset colors={listColors}>
          <ListItem title={failed ? "Couldn't load alerts. Try again." : 'Loading…'} />
        </List>
      </>
    )
  }

  if (!setup.available) {
    return (
      <>
        <BlockTitle>Alerts</BlockTitle>
        <Note>
          Alerts aren't set up on this server yet. Whoever runs it can turn them on: Traccar forwards its events to Panopticon, which sends
          the alerts (see the README's Alerts section).
        </Note>
      </>
    )
  }

  const busy = status.kind === 'busy'
  const name = setup.assets.find((asset) => asset.id === assetId)?.name ?? 'it'
  return (
    <>
      <BlockTitle>Alerts</BlockTitle>
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
            Get a notification when {name} leaves or arrives at one of its places, its tracker goes offline, or it hasn't been out for a
            while, also while Panopticon is closed. You choose which on each device, for each asset.
          </BlockFooter>
        </>
      )}

      {push.kind === 'on' &&
        setup.assets
          .filter((asset) => asset.id === assetId)
          .map((asset) => {
            const chosen = rules[asset.id] ?? []
            const walk = parseWalkRule(walkRuleOf(chosen) ?? DEFAULT_WALK_RULE)!
            const walkOn = walkRuleOf(chosen) !== undefined
            const picker = (label: string, value: number, options: { value: number; text: string }[], onPick: (value: number) => void) => (
              <select
                className="max-w-40 bg-transparent text-right text-primary disabled:opacity-50"
                aria-label={`${asset.name}: ${label}`}
                value={value}
                disabled={busy || !setup.canEdit}
                onChange={(event) => onPick(Number(event.target.value))}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.text}
                  </option>
                ))}
              </select>
            )
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
                <List strong inset colors={listColors}>
                  {asset.places.flatMap((place) => [
                    row(`leave:${place.id}`, `Leaves ${place.name}`),
                    row(`arrive:${place.id}`, `Arrives at ${place.name}`),
                  ])}
                  {row('offline', 'Tracker goes offline')}
                  <ListItem
                    title="Walk reminder"
                    after={
                      <Toggle
                        checked={walkOn}
                        disabled={busy || !setup.canEdit}
                        aria-label={`${asset.name}: Walk reminder`}
                        onChange={() => setWalk(asset.id, walkOn ? undefined : walk)}
                      />
                    }
                  />
                  {walkOn && (
                    <>
                      <ListItem
                        title="After"
                        after={picker(
                          'Remind after',
                          walk.minutes,
                          WALK_AFTER_MINUTES.map((minutes) => ({ value: minutes, text: hoursLabel(minutes) })),
                          (minutes) => setWalk(asset.id, { ...walk, minutes }),
                        )}
                      />
                      <QuietHours
                        key={`${walk.quietFrom}-${walk.quietUntil}`}
                        name={asset.name}
                        from={walk.quietFrom}
                        until={walk.quietUntil}
                        disabled={busy || !setup.canEdit}
                        onChange={(quietFrom, quietUntil) => setWalk(asset.id, { ...walk, quietFrom, quietUntil })}
                      />
                    </>
                  )}
                </List>
                {walkOn && (
                  <BlockFooter>
                    A reminder when {asset.name} has been home for {hoursLabel(walk.minutes)} since its last walk
                    {walk.quietFrom === walk.quietUntil
                      ? ', at any hour.'
                      : `, between ${hourLabel(walk.quietUntil)} and ${hourLabel(walk.quietFrom)}; one that comes due at night waits until then.`}{' '}
                    It reads {asset.name}'s history with a Traccar key of yours, kept sealed with the asset, and renewed when you open
                    Panopticon here: reminders stop when your sign-in here runs out.
                  </BlockFooter>
                )}
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
            in Traccar, sealed. Turning them off here turns them off for all assets on this device.
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

/** "10 PM", in the phone's way of telling the time. */
function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2026, 0, 1, hour % 24))
}

/** Saved this long after the last move of a handle, so dragging doesn't save each hour on the way. */
const QUIET_SAVE_MS = 700

/** Quiet hours when they're turned on: reminders from 7 to 22 (see DEFAULT_WALK_RULE). */
const QUIET_ON = { from: 22, until: 7 }

/**
 * Quiet hours: a switch, and with them on, one slider over the day, midnight to midnight, with two
 * handles: the hours reminders may come, filled between the handles; the rest is quiet. So quiet
 * hours always go round midnight (from the later handle to the earlier: reminders 7 to 22 are quiet
 * 22 to 7), and the handles keep at least an hour apart, and an hour of quiet. Off is the same hour
 * for both (`walk:120:0-0`). Each handle is a range input of its own, for the keyboard and screen
 * readers, laid over one track (styles.css, .quiet-hours).
 */
function QuietHours(props: {
  name: string
  from: number
  until: number
  disabled: boolean
  onChange: (from: number, until: number) => void
}) {
  const { name, disabled, onChange } = props
  const on = props.from !== props.until
  // The hours reminders may come: from where quiet ends to where it begins, that one on the next
  // day when it's earlier (quiet 22–0 is reminders 0–24, not 0–0).
  const [start, setStart] = useState(on ? props.until : 7)
  const [end, setEnd] = useState(on ? Math.min(24, props.from > props.until ? props.from : props.from + 24) : 22)
  const save = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(save.current), [])
  const move = (nextStart: number, nextEnd: number) => {
    setStart(nextStart)
    setEnd(nextEnd)
    clearTimeout(save.current)
    save.current = setTimeout(() => onChange(nextEnd % 24, nextStart), QUIET_SAVE_MS)
  }
  // Where an hour is along the track: the handles' centres stop half a handle in from its ends.
  const at = (hour: number) => `calc(${hour / 24} * (100% - 26px) + 13px)`
  const handle = (label: string, value: number, set: (value: number) => void) => (
    <input
      type="range"
      min={0}
      max={24}
      step={1}
      value={value}
      disabled={disabled}
      aria-label={`${name}: ${label}`}
      aria-valuetext={`${label} ${hourLabel(value)}`}
      onChange={(event) => set(Number(event.target.value))}
    />
  )
  return (
    <>
      <ListItem
        title="Quiet hours"
        after={
          <Toggle
            checked={on}
            disabled={disabled}
            aria-label={`${name}: Quiet hours`}
            onChange={() => (on ? onChange(0, 0) : onChange(QUIET_ON.from, QUIET_ON.until))}
          />
        }
      />
      {on && (
        <ListItem
          title="Reminders"
          after={<span className="opacity-60">{`${hourLabel(start)} – ${hourLabel(end)}`}</span>}
          innerChildren={
            <div className={`quiet-hours mt-3 mb-1 ${disabled ? 'opacity-50' : ''}`}>
              <div className="quiet-hours-track">
                <span className="quiet-hours-line" />
                <span className="quiet-hours-fill" style={{ left: at(start), width: `calc(${(end - start) / 24} * (100% - 26px))` }} />
                {/* An hour apart at least, and an hour of quiet: all day would be no quiet hours, which is the switch. */}
                {handle('Reminders from', start, (value) => move(Math.max(end - 23, Math.min(value, end - 1)), end))}
                {handle('Reminders until', end, (value) => move(start, Math.min(start + 23, Math.max(value, start + 1))))}
              </div>
              <div className="relative mt-1 h-4 text-xs opacity-50" aria-hidden="true">
                {[0, 6, 12, 18, 24].map((hour) => (
                  <span key={hour} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: at(hour) }}>
                    {hourLabel(hour)}
                  </span>
                ))}
              </div>
            </div>
          }
        />
      )}
    </>
  )
}

/** A message on its own: Konsta's BlockFooter pulls itself up to the list above, and with none, out of sight. */
function Note({ children }: { children: ReactNode }) {
  return <p className="px-8 pb-4 pt-2 text-sm opacity-70">{children}</p>
}
