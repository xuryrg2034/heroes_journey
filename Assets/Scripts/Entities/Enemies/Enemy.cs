using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using Cysharp.Threading.Tasks;
using Services.EventBus;
using UnityEngine.Events;
using Random = UnityEngine.Random;

namespace Entities.Enemies
{
    public class Enemy : BaseEntity
    {
        // Событие смерти, подписывайся на него в сервисе
        public static UnityEvent<Enemy> OnEnemyDeath = new();
        
        [Header("Enemy Settings")]
        [SerializeField] private EnemyRank rank;
        [SerializeField] private bool isAggressive; // Готов ли противник проявить агрессию
        [SerializeField] private int aggressionLimit; // Порог после которого будет пробрасываться шанс стать агрессивным
        private int _turnsInIdleState; // То сколько проитвник находится в состоянии покоя
        
        [SerializeReference, SubclassSelector]
        private List<BaseAbility> abilities = new();

        public EnemyRank Rank => rank;

        public override void Init()
        {
            base.Init();
            
            foreach (var ability in abilities)
            {
                ability.Init(this);
            }

            Health.OnDie.AddListener(_cancelAbilities);
            Health.OnDie.AddListener(_updateStatistics);
            Health.OnValueChanged.AddListener(_checkAggressionAfterTakeDamage);
            EventBusService.Subscribe(Actions.StatisticsUpdateTurnCounter, _onCheckAggressionAfterTurnPassed);
        }

        public async UniTask ExecuteAbilities()
        {
            if (!isAggressive) return;

            foreach (var ability in abilities)
            {
                if (ability == null || !ability.Enable) continue;
            
                await ability.Execute();

                if (ability.State == State.Completed)
                {
                    isAggressive = false;
                    _turnsInIdleState = 0;
                }
            }
        }

        private void _cancelAbilities()
        {
            foreach (var ability in abilities)
            {
                if (ability == null || !ability.Enable) continue;
            
                ability.Cancel();
            }
        }

        private void _checkAggressionAfterTakeDamage(int value)
        {
            isAggressive = !Health.IsDead;
        }
        
        public void _onCheckAggressionAfterTurnPassed()
        {
            if (isAggressive) return;

            _turnsInIdleState++;
            
            var requiredTurns = aggressionLimit * 1.5f;
            var chance = Mathf.Clamp01((_turnsInIdleState - 5) / requiredTurns);

            if (Random.value < chance)
            {
                isAggressive = true;
            }
        }
        
        private void _updateStatistics()
        {
            EventBusService.Trigger(Actions.EnemyDied);
        }

        public override void Dispose()
        {
            base.Dispose();
            EventBusService.Unsubscribe(Actions.StatisticsUpdateTurnCounter, _onCheckAggressionAfterTurnPassed);
        }
    }
    
    public enum EnemyRank
    {
        Boss,
        Common
    }
}