using System;
using System.Linq;
using UnityEngine;
using UnityEngine.UIElements;
using static UnityEditor.Progress;
using static UnityEngine.RuleTile.TilingRuleOutput;

public class FsmGamePlayState : FsmState
{
    private Fsm _fsm;
    private GridStore _gridStore;
    private Player _player;

    public FsmGamePlayState(Fsm fsm, GridStore gridStore, Player player) : base(fsm)
    {
        _fsm = fsm;
        _gridStore = gridStore;
        _player = player;
    }

    public override void Enter()
    {
        base.Enter();

        if (_gridStore.SelectedCell.Count == 0)
        {
            _fsm.SetState<FsmSpawnGemsState>();
        }
        else
        {
            CellPosition nextCellPosition = _gridStore.SelectedCell.First();
            _Gem gem = _gridStore.gemsGrid[nextCellPosition.Row, nextCellPosition.Column];
            _player.Move(gem.transform.position, nextCellPosition, () => { _fsm.SetState<FsmPlayerInteractState>(); });
        }
    } 

    public override void Exit()
    {
        base.Exit();
    }
}