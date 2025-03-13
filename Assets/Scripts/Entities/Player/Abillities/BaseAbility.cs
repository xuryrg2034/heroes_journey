using System;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;
using UnityEngine.Events;

namespace Entities.Player
{
    [Serializable]
    public abstract class BaseAbility
    {
        [SerializeField] private string title;
        [SerializeField] private int energyCost;
        [SerializeField] private int cooldown;

        private bool _enable;
        
        [HideInInspector]
        public UnityEvent<bool> OnEnableChanged = new();
        
        public bool Enable
        {
            get => _enable;
            private set
            {
                _enable = value;
                OnEnableChanged.Invoke(_enable);
            }
        }

        public string Title => title;
        
        public Hero Hero { get; private set; }

        protected BaseAbility() {}

        public virtual void Init(Hero hero)
        {
            Hero = hero;

            CheckEnable(Hero.Energy.Value);
            Hero.Energy.OnValueChanged.AddListener(CheckEnable);
        }
        
        private void CheckEnable(int energy)
        {
            var isEnoughEnergy = energy >= energyCost;

            Enable = isEnoughEnergy;
        }
        
        public abstract void SelectTarget(BaseEntity baseEntity);

        public virtual void Activate()
        {
            Hero.Energy.SetReserve(energyCost);
        }

        public virtual void Deactivate()
        {
            Hero.Energy.SetReserve(0);
        }

        public virtual UniTask Execute()
        {
            Hero.Energy.Decrease(Hero.Energy.Reserved);
            return default;
        }

        public abstract void Cancel();
        
        protected void _highlightTarget(Cell cell, bool highlight)
        {
            cell.Highlite(highlight);
        }
        
        protected bool _isInRange(Vector3 origin, Vector3 target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
    }
}