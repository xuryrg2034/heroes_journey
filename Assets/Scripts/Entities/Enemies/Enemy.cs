using System.Collections.Generic;
using UnityEngine;
using Cysharp.Threading.Tasks;
using Interfaces;
using Services.EventBus;
using UnityEngine.Events;
using Random = UnityEngine.Random;

namespace Entities.Enemies
{
    public class Enemy : BaseEntity, ISelectableEntity
    {
        // Событие смерти, подписывайся на него в сервисе
        public static UnityEvent<Enemy> OnEnemyDeath = new();
        
        [Header("Enemy Settings")]
        
        [SerializeField] bool isAggressive; // Готов ли противник проявить агрессию
        
        [SerializeReference, SubclassSelector]
        List<BaseAbility> abilities = new();
        
        public EntitySelectionType SelectionType { get; private set; }
        
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

        void _cancelAbilities()
        {
            foreach (var ability in abilities)
            {
                if (ability == null || !ability.Enable) continue;
            
                ability.Cancel();
            }
        }

        void _checkAggressionAfterTakeDamage(int value)
        {
            isAggressive = !Health.IsDead;
        }
        
        public void _onCheckAggressionAfterTurnPassed()
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
        
        void _updateStatistics()
        {
            EventBusService.Trigger(Actions.EnemyDied);
        }

        public override void Dispose()
        {
            base.Dispose();
            EventBusService.Unsubscribe(Actions.StatisticsUpdateTurnCounter, _onCheckAggressionAfterTurnPassed);
        }
    }
}