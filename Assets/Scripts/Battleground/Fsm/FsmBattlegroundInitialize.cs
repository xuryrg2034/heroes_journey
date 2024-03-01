using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class FsmBattlegroundInitialize : FsmState
{
    private Grid _grid;
    public FsmBattlegroundInitialize(
            Fsm fsm,
            Grid grid
        ) : base(fsm)
    {
        _grid = grid;
    }

    public override void Enter()
    {
        base.Enter();

        _grid.Initialize();
    }
}
