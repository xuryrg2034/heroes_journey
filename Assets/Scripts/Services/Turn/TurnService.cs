using Grid;
using UnityEngine;


namespace Services.Turn
{
    // TODO: По итогам стоит отказаться от монобеха и вызов старта хода делать через систему событий
    public class TurnService : MonoBehaviour
    {
        private TurnPhase _playerTurnPhase;
        private TurnPhase _enemyTurnPhase;
        private TurnPhase _allQuestsCompleteTurnPhase;

        private GridService _gridService;

        public void Init()
        {
            _gridService = ServiceLocator.Get<GridService>();

            _playerTurnPhase = new TurnPhasePlayer();
            _enemyTurnPhase = new TurnPhaseEnemy();

            _playerTurnPhase.OnChangeState.AddListener(_playerTurnEnd);
            _enemyTurnPhase.OnChangeState.AddListener(_enemyTurnEnd);
        }
        
        public void StartPlayerTurn()
        {
            GameService.SetGameState(GameState.PlayerTurn);
            _playerTurnPhase.Prepare();
            _playerTurnPhase.StartPhase();
        }

        private async void _playerTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await _gridService.UpdateGrid();
            
            GameService.SetGameState(GameState.EnemyTurn);
            _enemyTurnPhase.Prepare();
            
            _enemyTurnPhase.StartPhase();
        }
        
        private async void _enemyTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await _gridService.UpdateGrid();

            // Заменить на EventBus
            GameService.SetGameState(GameState.WaitingForInput);
        }
    }
}   