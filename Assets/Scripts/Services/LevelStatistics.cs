using Services.EventBus;
using UnityEngine;

namespace Services
{
    public class LevelStatistics
    {
        public int Kills { get; private set; }
        
        public int Turn { get; private set; }

        public int ItemsCollected { get; private set; }

        public LevelStatistics()
        {
            Reset();
            _subscribeEvents();
        }

        public void RegisterKill()
        {
            Kills++;
            Log();
            EventBusService.Trigger(Actions.StatisticsUpdateKillCounter);
        }
        
        public void IncreaseTurnCounter()
        {
            Turn++;
            Log();
            EventBusService.Trigger(Actions.StatisticsUpdateTurnCounter);
        }

        public void RegisterItemCollected()
        {
            ItemsCollected++;
        }

        public void Reset()
        {
            Kills = 0;
            ItemsCollected = 0;
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
        
        // private void _unsubscribeEvents()
        // {
        //     EventBusService.Unsubscribe(Actions.EnemyDied, RegisterKill);
        // }
     }
}