using UnityEngine;

public class FsmPlayerInteractState : FsmState
{
    private Fsm _fsm;
    private GridStore _gridStore;
    private Player _player;

    public FsmPlayerInteractState(Fsm fsm, GridStore gridStore, Player player) : base(fsm)
    {
        _fsm = fsm;
        _gridStore = gridStore;
        _player = player;
    }

    public override void Enter()
    {

        base.Enter();

        int playerRow = _player.PositionOnBoard.Row;
        int playerColumn = _player.PositionOnBoard.Column;
        _Gem gemByPlayerPosition = _gridStore.gemsGrid[playerRow, playerColumn];

        if (gemByPlayerPosition != null)
        {
            _player.Interact(gemByPlayerPosition);

            if (gemByPlayerPosition.IsDead)
            {
                gemByPlayerPosition.Dead();
                // Костыль, поскольку удаление элемента в gemByPlayerPosition.Dead() отрабатывает медленно
                _gridStore.gemsGrid[playerRow, playerColumn] = null;
                _gridStore.SelectedCell.Remove(gemByPlayerPosition.PositionOnBoard);
                _fsm.SetState<FsmGamePlayState>();
            }
        }
    } 
}
