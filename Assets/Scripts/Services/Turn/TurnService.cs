using DG.Tweening;
using Services.Grid;
using Services.Abilities;
using Services.Quest;
using Services.UI;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Serialization;


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
            // _playerTurnPhase.OnTurnCompleted -= _updateGrid;
            // _enemyTurnPhase.OnTurnCompleted -= _updateGrid;
        }

        private void OnEnable()
        {
            // TurnPhase.OnSomeTurnStart += _disablePlayerUI;
            // TurnPhase.OnSomeTurnCompleted += _updateGrid;
        }

        private void Start()
        {
            _playerTurnPhase = new TurnPhasePlayer();
            _enemyTurnPhase = new TurnPhaseEnemy();
            // _questTurnPhase = new TurnPhaseCheckQuests();

            _playerTurnPhase.OnTurnCompleted += _updateGrid;
            _enemyTurnPhase.OnTurnCompleted += _updateGrid;
        }
        
        public void StartPlayerTurn()
        {
            GameService.SetGameState(GameState.PlayerTurn);
            _playerTurnPhase.StartPhase();
        }

        public void StartEnemyTurn()
        {
            GameService.SetGameState(GameState.EnemyTurn);
            _enemyTurnPhase.StartPhase();
        }

        // public void StartQuestService()
        // {
        //     GameService.SetGameState(GameState.QuestCheck);
        //     _questTurnPhase.StartPhase();
        // }
        
        private async void _updateGrid()
        {
            await GridService.Instance.UpdateGrid();
            
            GameService.SetGameState(GameState.WaitingForInput);
        }
    }
}