﻿using Grid;
using UnityEngine;


namespace Services.Turn
{
    public class TurnService : MonoBehaviour
    {
        TurnPhase _playerTurnPhase;
        TurnPhase _enemyTurnPhase;
        TurnPhase _allQuestsCompleteTurnPhase;

        GridService _gridService;

        public void Init()
        {
            _gridService = ServiceLocator.Get<GridService>();

            _playerTurnPhase = new TurnPhasePlayer();
            _enemyTurnPhase = new TurnPhaseEnemy();

            _playerTurnPhase.OnChangeState.AddListener(PlayerTurnEnd);
            _enemyTurnPhase.OnChangeState.AddListener(EnemyTurnEnd);
        }
        
        public void StartPlayerTurn()
        {
            _playerTurnPhase.Prepare();
            _playerTurnPhase.StartPhase();
        }

        async void PlayerTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await _gridService.UpdateGrid();

            _enemyTurnPhase.Prepare();
            
            _enemyTurnPhase.StartPhase();
        }
        
        async void EnemyTurnEnd(TurnState state)
        {
            if (state != TurnState.Completed) return;
            
            await _gridService.UpdateGrid();
        }
    }
}   