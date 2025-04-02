using Grid;
using UnityEngine;


namespace Services.Turn
{
    public class TurnService : MonoBehaviour
    {
        TurnPhase _playerTurnPhase;
        TurnPhase _enemyTurnPhase;
        TurnPhase _allQuestsCompleteTurnPhase;

        UiStateService _uiStateService;
        GridService _gridService;

        public void Init()
        {
            _gridService = ServiceLocator.Get<GridService>();
            _uiStateService = ServiceLocator.Get<UiStateService>();

            _playerTurnPhase = new TurnPhasePlayer();
            _enemyTurnPhase = new TurnPhaseEnemy();

            _playerTurnPhase.OnChangeState.AddListener(PlayerTurnEnd);
            _enemyTurnPhase.OnChangeState.AddListener(EnemyTurnEnd);
        }
        
        public void PlayerTurnStart()
        {
            _uiStateService.SetState(UiGameState.PlayerTurn);
            _playerTurnPhase.Prepare();
            _playerTurnPhase.StartPhase();
        }
        
        void EnemyTurnStart()
        {
            _uiStateService.SetState(UiGameState.EnemyTurn);
            _enemyTurnPhase.Prepare();
            _enemyTurnPhase.StartPhase();
        }

        async void PlayerTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await _gridService.UpdateGrid();
            EnemyTurnStart();
        }
        
        async void EnemyTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await _gridService.UpdateGrid();
            _uiStateService.SetState(UiGameState.Idle);
        }
    }
}   