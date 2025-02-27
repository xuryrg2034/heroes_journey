using System;
using Abilities.EnemyAbilities;
using DG.Tweening;
using TMPro;
using UnityEngine;
using Cysharp.Threading.Tasks;
using UnityEngine.Events;

namespace Core.Entities
{
    public class Enemy : Entity
    {
        // Событие смерти, подписывайся на него в сервисе
        public static UnityEvent<Enemy> OnEnemyDeath = new();
        
        [Header("Enemy Settings")]
        [SerializeField] private EnemyRank rank;
        [SerializeField] private TextMeshPro healthUI;
        
        public BaseAbility[] Abilities { get; private set; }
        

        public EnemyRank Rank => rank;

        // private void OnEnable()
        // {
        //     OnHealthChange += _healthUpdateUI;
        // }
        //
        // private void OnDisable()
        // {
        //     OnHealthChange -= _healthUpdateUI;
        // }
        
        protected void Start()
        {
            // Abilities = GetComponents<BaseAbility>()
            //     .OrderBy(item => item.Order)
            //     .ToArray();
            // _prepareHealth();
        }

        public Tween ExecuteAbilities()
        {
            var sequence = DOTween.Sequence(null);

            // foreach (var ability in Abilities)
            // {
            //     if (!ability.Enable) continue;
            //
            //     var executionAbility = ability.Execute();
            //     sequence.Append(executionAbility);
            // }
            //
            // sequence.OnComplete(() =>
            // {
            //     Debug.Log("End executing abilities");
            // });   

            return sequence;
        }

        // private void _prepareHealth()
        // {
        //     _healthUpdateUI();
        // }
        //
        // private void _healthUpdateUI()
        // {
        //     healthUI.text = Health.ToString();
        // }
    }
    
    public enum EnemyRank
    {
        Boss,
        Common
    }
}