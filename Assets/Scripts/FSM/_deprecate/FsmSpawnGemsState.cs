using System.Collections;
using UnityEngine;

public class FsmSpawnGemsState : FsmState
{
    private Fsm _fsm;
    private GridStore _gridStore;
    private Player _player;

    public FsmSpawnGemsState(Fsm fsm, GridStore gridStore, Player player) : base(fsm)
    {
        _fsm = fsm;
        _gridStore = gridStore;
        _player = player;
    }

    public override void Enter()
    {
        base.Enter();

        _gridStore.FillGemsGrid();
        _fsm.SetState<FsmUserTurnState>();
    }
}