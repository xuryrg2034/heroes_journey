using System.Collections.Generic;
using Abilities.EnemyAbilities;
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
        }

        public async UniTask ExecuteAbilities()
        {
            foreach (var ability in abilities)
            {
                if (!ability.Enable) continue;
            
                await ability.Execute();
            }
        }

        private void _cancelAbilities()
        {
            foreach (var ability in abilities)
            {
                if (!ability.Enable) continue;
            
                ability.Cancel();
            }
        }
    }
    
    public enum EnemyRank
    {
        Boss,
        Common
    }
}