using Cysharp.Threading.Tasks;
using Services.Grid;
using UnityEngine;


namespace Services.Turn
{
    public class TurnService : MonoBehaviour
    {
        private TurnPhase _playerTurnPhase;
        private TurnPhase _enemyTurnPhase;
        private TurnPhase _allQuestsCompleteTurnPhase;
        // private TurnPhase _questTurnPhase;

        private void OnDisable()
        {
            _playerTurnPhase.OnChangeState.RemoveListener(_playerTurnEnd);
            _enemyTurnPhase.OnChangeState.RemoveListener(_enemyTurnEnd);
        }

        private void Start()
        {
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
            
            await GridService.Instance.UpdateGrid();
            
            GameService.SetGameState(GameState.EnemyTurn);
            _enemyTurnPhase.Prepare();
            
            _enemyTurnPhase.StartPhase();
        }
        
        private async void _enemyTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await GridService.Instance.UpdateGrid();

            // Заменить на EventBus
            GameService.SetGameState(GameState.WaitingForInput);
        }
    }
}   