import { useNavigate } from 'react-router-dom'
import { srColor, fmtVal, fmtSR, fmtBonus, fmtBowlBase } from '../../utils/mvpDisplay'

function PlayerLink({ playerId, name, dn }) {
  const navigate = useNavigate()
  if (playerId > 0)
    return (
      <span className="player-link" onClick={() => navigate(`/player/${playerId}`)}>
        {dn(name)}
      </span>
    )
  return dn(name)
}

export default function MvpFormulaRow({ p, i, mvpLength, dn, teamSR }) {
  return (
    <tr
      style={{
        borderBottom: i < mvpLength - 1 ? '1px solid var(--border)' : 'none',
        opacity: i >= 3 ? 0.7 : 1
      }}
    >
      <td style={{ paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}>
        <PlayerLink playerId={p.playerId} name={p.name} dn={dn} />
      </td>
      <td style={{ textAlign: 'right' }}>{fmtVal(p.batBase)}</td>
      <td style={{ textAlign: 'right', color: srColor(p.batSR, teamSR) }}>{fmtSR(p.batSR)}</td>
      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtBonus(p.batSRBonus)}</td>
      <td style={{ textAlign: 'right' }}>{fmtBowlBase(p)}</td>
      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtBonus(p.bowlHaulBonus)}</td>
      <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmtBonus(p.bowlMaidenBonus)}</td>
      <td style={{ textAlign: 'right' }}>{fmtVal(p.field)}</td>
      <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text1)' }}>{p.total}</td>
    </tr>
  )
}
