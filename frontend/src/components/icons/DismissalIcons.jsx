import { HandCoins, HelpCircle, Lock } from 'lucide-react'

export const BowledPngIcon = ({ size = 18 }) => (
  <img
    src="/cricket.png"
    alt="bowled"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
export const CatchingIcon = ({ size = 18 }) => (
  <img
    src="/catching.png"
    alt="caught"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
export const LBWIcon = ({ size = 18 }) => (
  <img
    src="/pads.png"
    alt="lbw"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
export const RunOutIcon = ({ size = 18 }) => (
  <img
    src="/runer-silhouette-running-fast.png"
    alt="run out"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)

export const DISMISSAL_ICONS = {
  Bowled: BowledPngIcon,
  Caught: CatchingIcon,
  CaughtAndBowled: HandCoins,
  LBW: LBWIcon,
  'Run out': RunOutIcon,
  RunOut: RunOutIcon,
  Stumped: Lock,
  Other: HelpCircle
}
