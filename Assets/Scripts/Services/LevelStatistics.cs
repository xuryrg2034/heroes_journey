﻿using Services.EventBus;
using UnityEngine;

namespace Services
{
    public class LevelStatistics
    {
        public int Kills { get; private set; }
        
        public int Turn { get; private set; }

        public LevelStatistics()
        {
            Reset();
            _subscribeEvents();
        }

        public void RegisterKill()
        {
            Kills++;
            EventBusService.Trigger(Actions.StatisticsUpdateKillCounter);
        }
        
        public void IncreaseTurnCounter()
        {
            Turn++;
            EventBusService.Trigger(Actions.StatisticsUpdateTurnCounter);
        }

        public void Reset()
        {
            Kills = 0;
        }

        public void Log()
        {
             Debug.Log($"Kills: {Kills}, Turns: {Turn}");
        }

        private void _subscribeEvents()
        {
            EventBusService.Subscribe(Actions.EnemyDied, RegisterKill);
            EventBusService.Subscribe(Actions.PlayerTurnStart, IncreaseTurnCounter);
        }
     }
}