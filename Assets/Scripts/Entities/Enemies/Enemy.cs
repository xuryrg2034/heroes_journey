using System.Collections.Generic;
using UnityEngine;
using Cysharp.Threading.Tasks;
using Interfaces;
using Services.EventBus;
using UnityEngine.Events;
using Random = UnityEngine.Random;

namespace Entities.Enemies
{
    public class Enemy : BaseEntity
    {
        [Header("Enemy Settings")]
        
        [SerializeField] bool isAggressive; // Готов ли противник проявить агрессию
        
        [SerializeReference, SubclassSelector]
        List<BaseAbility> abilities = new();
        
        int _turnsInIdleState; // Сколько ходов проитвник находится в состоянии покоя
        
        int _aggressionLimit; // Порог после которого будет пробрасываться шанс стать агрессивным

        public void Init(IEnemyConfig config)
        {
            base.Init(config);
            
            SelectionType = config.SelectionType;
            _aggressionLimit = config.AggressionLimit;
            
            foreach (var ability in abilities)
            {
                ability.Init(this);
            }

            Health.OnDie.AddListener(CancelAbilities);
            Health.OnDie.AddListener(UpdateStatistics);
            Health.OnValueChanged.AddListener(CheckAggressionAfterTakeDamage);
            EventBusService.Subscribe(Actions.StatisticsUpdateTurnCounter, OnCheckAggressionAfterTurnPassed);
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

        void CancelAbilities()
        {
            foreach (var ability in abilities)
            {
                if (ability == null || !ability.Enable) continue;
            
                ability.Cancel();
            }
        }

        void CheckAggressionAfterTakeDamage(int value)
        {
            isAggressive = !Health.IsDead;
        }
        
        void OnCheckAggressionAfterTurnPassed()
        {
            if (isAggressive) return;

            _turnsInIdleState++;
            
            var requiredTurns = _aggressionLimit * 1.5f;
            var chance = Mathf.Clamp01((_turnsInIdleState - 5) / requiredTurns);

            if (Random.value < chance)
            {
                isAggressive = true;
            }
        }
        
        void UpdateStatistics()
        {
            EventBusService.Trigger(Actions.EnemyDied);
        }

        public override void Dispose()
        {
            base.Dispose();
            EventBusService.Unsubscribe(Actions.StatisticsUpdateTurnCounter, OnCheckAggressionAfterTurnPassed);
        }
    }
}