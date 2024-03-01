using UnityEngine;

public class FsmUserTurnState : FsmState
{
    private Fsm _fsm;
    private GridStore _gridStore;
    private Player _player;
    private int _virtualPlayerPositionRow;
    private int _virtualPlayerPositionColumn;

    public FsmUserTurnState(Fsm fsm, GridStore gridStore, Player player) : base(fsm)
    {
        _fsm = fsm;
        _gridStore = gridStore;
        _player = player;
    }

    public override void Enter()
    {
        base.Enter();

        _virtualPlayerPositionRow = _player.PositionOnBoard.Row;
        _virtualPlayerPositionColumn = _player.PositionOnBoard.Column;

        _gridStore.ChangeAvailableType(0);

        var gemsGrid = _gridStore.gemsGrid;

        for (int i = 0; i < gemsGrid.GetLength(0); i++)
        {
            for (int j = 0; j < gemsGrid.GetLength(1); j++)
            {

                var gem = gemsGrid[i, j];

                if (gem)
                {
                    gem.EnableSelection(OnGemClick);
                }
                else
                {
                    Debug.Log(gem);
                }
            }
        }
    } 

    public override void Exit()
    {
        base.Exit();

        var gemsGrid = _gridStore.gemsGrid;

        for (int i = 0; i < gemsGrid.GetLength(0); i++)
        {
            for (int j = 0; j < gemsGrid.GetLength(1); j++)
            {
                var gem = gemsGrid[i, j];

                if (gem)
                {
                    gem.DisableSelection();
                }
            }
        }
    }

    private void OnGemClick(_Gem gem)
    {
        var gemRow = gem.PositionOnBoard.Row;
        var gemColumn = gem.PositionOnBoard.Column;
        var gemGridVector = new Vector3(gemRow, gemColumn, 0);

        var playerRow = _virtualPlayerPositionRow;
        var playerColumn = _virtualPlayerPositionColumn;
        var playerGridVector = new Vector3(playerRow, playerColumn, 0);

        var isGemNeighbor = Vector3.Distance(playerGridVector, gemGridVector) < _player.BaseRange;
        var isValidGemType = _gridStore.AvailableTypeForSelection == 0 || _gridStore.AvailableTypeForSelection == gem.type;
        var isGemSelected = _gridStore.SelectedCell.Contains(gem.PositionOnBoard);

        if (isGemSelected)
        {
            _gridStore.RemoveRangeFrom(_gridStore.SelectedCell.IndexOf(gem.PositionOnBoard));
            _gridStore.ChangeAvailableType(gem.type);
            _virtualPlayerPositionColumn = gemColumn;
            _virtualPlayerPositionRow = gemRow;
        }
        else if(isGemNeighbor && isValidGemType) { 
            _gridStore.ChangeAvailableType(gem.type);
            _gridStore.SelectCell(gem.PositionOnBoard);
            _virtualPlayerPositionColumn = gemColumn;
            _virtualPlayerPositionRow = gemRow;
        }

        Debug.Log(_gridStore.SelectedCell.Count);
    }

    public override void Update() {
        
        base.Update();
    }
}
