import { Link } from '@tanstack/react-router'

/** A round cog button on the map that goes straight to the settings page. */
export function SettingsLink() {
  return (
    <Link to="/settings" className="settings-link" aria-label="Settings">
      <CogIcon />
    </Link>
  )
}

/** Eight evenly spaced, tapered teeth and a round hole; generated, not hand-drawn, so it's symmetric. */
function CogIcon() {
  return (
    <svg className="settings-link-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.83 3.89L10.09 1.17A11 11 0 0 1 13.91 1.17L14.17 3.89A8.4 8.4 0 0 1 16.20 4.73L18.31 2.99A11 11 0 0 1 21.01 5.69L19.27 7.80A8.4 8.4 0 0 1 20.11 9.83L22.83 10.09A11 11 0 0 1 22.83 13.91L20.11 14.17A8.4 8.4 0 0 1 19.27 16.20L21.01 18.31A11 11 0 0 1 18.31 21.01L16.20 19.27A8.4 8.4 0 0 1 14.17 20.11L13.91 22.83A11 11 0 0 1 10.09 22.83L9.83 20.11A8.4 8.4 0 0 1 7.80 19.27L5.69 21.01A11 11 0 0 1 2.99 18.31L4.73 16.20A8.4 8.4 0 0 1 3.89 14.17L1.17 13.91A11 11 0 0 1 1.17 10.09L3.89 9.83A8.4 8.4 0 0 1 4.73 7.80L2.99 5.69A11 11 0 0 1 5.69 2.99L7.80 4.73A8.4 8.4 0 0 1 9.83 3.89ZM12 8.6A3.4 3.4 0 1 0 12 15.4A3.4 3.4 0 1 0 12 8.6Z"
      />
    </svg>
  )
}
