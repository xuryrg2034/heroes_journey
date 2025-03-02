using System;
using UnityEngine;

namespace Core.Quest
{
    [Serializable]
    public class TotalKillEnemiesQuest : BaseQuestItem
    {
        [SerializeField] private int targetCount = 5;

        private int _currentCount;
        
        public override void OnCheckCondition<T>(T input = default)
        {
            if (IsCompleted)
                return;
            
            _currentCount++;
            
            OnUpdate?.Invoke();
            
            Debug.Log($"Убито врагов: {_currentCount}/{targetCount}");
            
            if (_currentCount < targetCount) return;
            
            _setIsComplete(true);
            
            OnComplete?.Invoke();
            Debug.Log("Квест 'убить врагов' выполнен!");
        }

        public override string GetProgress()
        {
            return $"{_currentCount}/{targetCount}";
        }
    }
}