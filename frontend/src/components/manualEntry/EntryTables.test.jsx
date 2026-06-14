import { render, screen, fireEvent } from '@testing-library/react'
import { BattingTable, BowlingTable, FieldingTable } from './EntryTables'

const noop = () => {}

describe('BattingTable', () => {
  const playerNames = ['Alice', 'Bob']

  test('renders column headers for standard format', () => {
    render(
      <BattingTable
        rows={[]}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
        playerNames={playerNames}
        isPairs={false}
      />
    )
    expect(screen.getByText('Player')).toBeInTheDocument()
    expect(screen.getByText('How out')).toBeInTheDocument()
    expect(screen.getByText('R')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('NO')).toBeInTheDocument()
    expect(screen.getByText('DNB')).toBeInTheDocument()
  })

  test('renders Out column for pairs format', () => {
    render(
      <BattingTable
        rows={[]}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
        playerNames={playerNames}
        isPairs={true}
      />
    )
    expect(screen.getByText('Out')).toBeInTheDocument()
  })

  test('renders a row for each entry', () => {
    const rows = [
      {
        player_name: 'Alice',
        how_out: 'b Smith',
        runs: 25,
        balls: 20,
        fours: 2,
        sixes: 0,
        not_out: false,
        did_not_bat: false,
        times_out: 0
      }
    ]
    render(
      <BattingTable
        rows={rows}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
        playerNames={playerNames}
        isPairs={false}
      />
    )
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument()
    expect(screen.getByDisplayValue('b Smith')).toBeInTheDocument()
  })

  test('shows Add batter button', () => {
    render(
      <BattingTable
        rows={[]}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
        playerNames={[]}
        isPairs={false}
      />
    )
    expect(screen.getByText('+ Add batter')).toBeInTheDocument()
  })

  test('calls onAdd when Add batter is clicked', () => {
    const onAdd = vi.fn()
    render(
      <BattingTable
        rows={[]}
        onChange={noop}
        onAdd={onAdd}
        onRemove={noop}
        playerNames={[]}
        isPairs={false}
      />
    )
    fireEvent.click(screen.getByText('+ Add batter'))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})

describe('BowlingTable', () => {
  test('renders column headers', () => {
    render(<BowlingTable rows={[]} onChange={noop} onAdd={noop} onRemove={noop} playerNames={[]} />)
    expect(screen.getByText('Overs')).toBeInTheDocument()
    expect(screen.getByText('W')).toBeInTheDocument()
    expect(screen.getByText('Wd')).toBeInTheDocument()
    expect(screen.getByText('NB')).toBeInTheDocument()
    expect(screen.getByText('+ Add bowler')).toBeInTheDocument()
  })

  test('renders a row for each entry', () => {
    const rows = [
      {
        player_name: 'Bob',
        overs: '4.0',
        maidens: 0,
        wicket_maidens: 0,
        runs: 22,
        wickets: 2,
        wides: 1,
        no_balls: 0
      }
    ]
    render(
      <BowlingTable rows={rows} onChange={noop} onAdd={noop} onRemove={noop} playerNames={[]} />
    )
    expect(screen.getByDisplayValue('Bob')).toBeInTheDocument()
  })
})

describe('FieldingTable', () => {
  test('renders column headers', () => {
    render(
      <FieldingTable rows={[]} onChange={noop} onAdd={noop} onRemove={noop} playerNames={[]} />
    )
    expect(screen.getByText('Catches')).toBeInTheDocument()
    expect(screen.getByText('Stumpings')).toBeInTheDocument()
    expect(screen.getByText('Run outs')).toBeInTheDocument()
    expect(screen.getByText('+ Add fielder')).toBeInTheDocument()
  })

  test('renders a row for each entry', () => {
    const rows = [{ player_name: 'Carol', catches: 2, stumpings: 0, run_outs: 1 }]
    render(
      <FieldingTable rows={rows} onChange={noop} onAdd={noop} onRemove={noop} playerNames={[]} />
    )
    expect(screen.getByDisplayValue('Carol')).toBeInTheDocument()
  })
})
