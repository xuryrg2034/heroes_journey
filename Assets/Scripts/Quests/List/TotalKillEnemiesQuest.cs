using System;
using Services.EventBus;
using UnityEngine;

namespace Quests
{
    [Serializable]
    public class TotalKillEnemiesQuest : BaseQuestItem
    {
        [SerializeField] private int targetCount = 5;

        private int _currentCount;

        public override void Init()
        {
            base.Init();
            
            EventBusService.Subscribe(GameEvents.StatisticsUpdateKillCounter, OnCheckCondition);
        }

        public override void OnCheckCondition()
        {
            if (IsCompleted)
            {
                EventBusService.Unsubscribe(GameEvents.StatisticsUpdateKillCounter, OnCheckCondition);
                return;
            }
            
            _currentCount = LevelStatistics.Kills;
            
            OnUpdate.Invoke();
            
            if (_currentCount < targetCount) return;
            
            _setIsComplete(true);
            
            OnComplete.Invoke();
        }

        public override string GetProgress()
        {
            return $"{_currentCount}/{targetCount}";
        }
    }
}