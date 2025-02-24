using System;
using System.Linq;
using Abilities.EnemyAbilities;
using DG.Tweening;
using Managers.Randomization;
using TMPro;
using UnityEngine;

namespace Core.Entities
{
    public class Enemy : Entity
    {
        // Событие смерти, подписывайся на него в сервисе
        public static event Action<Enemy> OnEnemyDeath;
        
        [Header("Enemy Settings")]
        [SerializeField] private EnemyColor color;
        [SerializeField] private TextMeshPro healthUI;
        [SerializeField] private EnemyType rank = EnemyType.Common;

        public EnemyColor Color => color;
        public BaseAbility[] Abilities;
        public EnemyType Rank => rank;

        private void OnEnable()
        {
            OnHealthChange += _healthUpdateUI;
        }

        private void OnDisable()
        {
            OnHealthChange -= _healthUpdateUI;
        }

        protected override void Start()
        {
            base.Start();

            _setColorByType();
            _prepareHealth();

            
            Type = EntityType.Enemy;
            Abilities = GetComponents<BaseAbility>()
                .OrderBy(item => item.Order)
                .ToArray();
        }

        public override void Die()
        {
            base.Die();

            OnEnemyDeath?.Invoke(this);
        }

        public Tween ExecuteAbilities()
        {
            var sequence = DOTween.Sequence(null);

            foreach (var ability in Abilities)
            {
                if (!ability.Enable) continue;

                var executionAbility = ability.Execute();
                sequence.Append(executionAbility);
            }

            sequence.OnComplete(() =>
            {
                Debug.Log("End executing abilities");
            });   

            return sequence;
        }

        private void _prepareHealth()
        {
            _healthUpdateUI();
        }

        private void _healthUpdateUI()
        {
            healthUI.text = Health.ToString();
        }
        
        private void _setColorByType()
        {
            switch (Color)
            {
                case EnemyColor.Red:
                    SRenderer.color = UnityEngine.Color.red;
                    _initColor = SRenderer.color;
                    break;
                
                case EnemyColor.Green:
                    SRenderer.color = UnityEngine.Color.green;
                    _initColor = SRenderer.color;
                    break;

                default:
                    SRenderer.color = UnityEngine.Color.white;
                    _initColor = SRenderer.color;
                    break;
            }
        }
    }
    
    public enum EnemyColor
    {
        Red,
        Green,
    }
    
    public enum EnemyType
    {
        Boss,
        Common
    }
}