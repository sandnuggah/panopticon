import type { IControl } from 'maplibre-gl'

/**
 * A button in the map's control column, styled like maplibre's own zoom buttons. `icon` is a fixed
 * SVG string from this codebase, never data. It can show a pressed state (e.g. your position on).
 */
export class MapButtonControl implements IControl {
  private container: HTMLDivElement | undefined
  private button: HTMLButtonElement | undefined

  constructor(
    private readonly className: string,
    private readonly icon: string,
    private readonly onClick: (button: HTMLButtonElement) => void,
    private readonly labels: { off: string; on?: string },
  ) {}

  onAdd(): HTMLElement {
    this.container = document.createElement('div')
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = this.className
    button.innerHTML = this.icon
    button.addEventListener('click', this.click)
    this.button = button
    this.setOn(false)
    this.container.append(button)
    return this.container
  }

  onRemove(): void {
    this.button?.removeEventListener('click', this.click)
    this.container?.remove()
  }

  setOn(on: boolean): void {
    if (!this.button) return
    const label = on && this.labels.on ? this.labels.on : this.labels.off
    this.button.setAttribute('aria-label', label)
    this.button.title = label
    if (this.labels.on) this.button.setAttribute('aria-pressed', String(on))
    else this.button.setAttribute('aria-expanded', String(on))
  }

  private readonly click = () => {
    if (this.button) this.onClick(this.button)
  }
}
