using System;
using UnityEngine;
using Core.Entities;
using Grid;
using Services.Grid;
using Services.Quest;

namespace Core.Quest
{
    public class KillThisEnemyQuest : QuestItem
    {
        // [SerializeField] private EnemyColor targetColor;
        // [SerializeField] private EnemyType targetType;

        private void OnEnable()
        {
            // Enemy.OnEnemyDeath += OnCheckCondition;
        }

        private void OnDisable()
        {
            // Enemy.OnEnemyDeath -= OnCheckCondition;
        }

        public override void OnCheckCondition<T>(T input = default)
        {
            if (IsCompleted)
                return;
            
            //
            // if (input is Enemy enemy == false) return;
            // if (enemy.Rank != targetType || enemy.Color != targetColor) return;

            OnUpdate?.Invoke();
            
            Debug.Log("Босс побежден");
            
            _setIsComplete(true);
            
            OnComplete?.Invoke();
            Debug.Log("Квест 'победить босса' выполнен!");
        }

        public override string GetProgress()
        {
            var current = IsCompleted ? 1 : 0;
            return $"{current}/1";
        }
    }
}