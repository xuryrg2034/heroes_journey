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
        
        [SerializeReference, SubclassSelector]
        private List<BaseAbility> abilities = new();

        private TextMeshPro _healthUI;

        public EnemyRank Rank => rank;

        public override void Init()
        {
            base.Init();
            
            foreach (var ability in abilities)
            {
                ability?.Init(this);
            }

            if (Health.Value > 0)
            {
                _initHealthUI();   
            }
            Health.OnDie.AddListener(_cancelAbilities);
        }

        public async UniTask ExecuteAbilities()
        {
            foreach (var ability in abilities)
            {
                if (ability == null || !ability.Enable) continue;
            
                await ability.Execute();
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

        private void _initHealthUI()
        {
            // Добавляем текст для здоровья
            var healthTextObj = new GameObject("HealthText");
            healthTextObj.transform.SetParent(transform, false); // Ставим текст в родителя

            // Добавляем компонент для текста
            _healthUI = healthTextObj.AddComponent<TextMeshPro>();
            _healthUI.text = Health.Value.ToString();  // Показываем здоровье
            _healthUI.alignment = TextAlignmentOptions.Center;
            _healthUI.fontSize = 5;
            _healthUI.sortingOrder = 110;

            // Размещаем текст
            var rectTransform = healthTextObj.GetComponent<RectTransform>();
            rectTransform.localPosition = new Vector3(0.18f, -0.19f, 0); // Немного выше врага
            
            Health.OnValueChanged.AddListener(_updateHealthUI);
        }

        private void _updateHealthUI(int value)
        {
            _healthUI.text = value.ToString();
        }
    }
    
    public enum EnemyRank
    {
        Boss,
        Common
    }
}