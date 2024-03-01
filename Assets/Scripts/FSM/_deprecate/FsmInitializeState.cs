using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

public class FsmInitializeState : FsmState
{
    private Fsm _fsm;
    private GridStore _gridStore;
    private Player _player;

    public FsmInitializeState(Fsm fsm, GridStore gridStore, Player player) : base(fsm)
    {
        _fsm = fsm;
        _gridStore = gridStore;
        _player = player;
    }

    public override void Enter()
    {
        base.Enter();
        
        Initialize();

        _fsm.SetState<FsmUserTurnState>();
    }

    private void Initialize()
    {
        _gridStore.CreateCellGrid();
        _gridStore.FillGemsGrid();
        InitializePlayer();
    }

    private void InitializePlayer()
    {
        var transform = _gridStore.grid.transform;
        var position = transform.position;
        var localScale = _gridStore.grid.transform.localScale;
        var playerPosition = position + Vector3.down * _player.PositionOnBoard.Row + Vector3.right * _player.PositionOnBoard.Column + Vector3.forward * 3;

        _player.transform.parent = _gridStore.grid.transform;
        _player.transform.position = playerPosition;
    }
}
