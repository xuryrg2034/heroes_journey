using UnityEngine;
using Core.Entities;

namespace Core.Quest
{
    public class KillEnemiesQuest : QuestItem
    {
        [SerializeField] private int target = 5;

        private int _current;

        private void OnEnable()
        {
            Enemy.OnEnemyDeath += OnCheckCondition;
        }

        private void OnDisable()
        {
            Enemy.OnEnemyDeath -= OnCheckCondition;
        }
        
        public override void OnCheckCondition<T>(T input = default)
        {
            if (IsCompleted)
                return;
            
            _current++;
            
            OnUpdate?.Invoke();
            
            Debug.Log($"Убито врагов: {_current}/{target}");
            
            if (_current < target) return;
            
            _setIsComplete(true);
            
            OnComplete?.Invoke();
            Debug.Log("Квест 'убить врагов' выполнен!");
        }

        public override string GetProgress()
        {
            return $"{_current}/{target}";
        }
    }
}