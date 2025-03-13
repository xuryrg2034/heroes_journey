using System;
using Cysharp.Threading.Tasks;
using Entities.Components;
using UnityEngine;

namespace Entities.Player
{
    [Serializable]
    public class JumpAttack : BaseAbility
    {
        [SerializeField] private int damage;

        private BaseEntity _selectTarget;
        
        public override void Activate()
        {
            base.Activate();

            ClickHandler.OnEntityClicked.AddListener(SelectTarget);
        }

        public override void Deactivate()
        {
            base.Deactivate();
            
            ClickHandler.OnEntityClicked.RemoveListener(SelectTarget);

            _resetSelection();
        }
        
        public override void SelectTarget(BaseEntity baseEntity)
        {
            if (baseEntity == Hero)
            {
                _resetSelection();
                return;
            }

            _resetSelection();

            if (baseEntity.Health.Value - damage > 0) return;
            
            _selectTarget = baseEntity;
            // _highlightTarget(baseEntity.Cell, true);
        }

        public override async UniTask Execute()
        {
            if (!_selectTarget)
            {
                _resetSelection();
                return;
            };

            await base.Execute();

            
            await Hero.Move(_selectTarget.GridPosition, 0.1f);
            await _selectTarget.Health.TakeDamage(damage);
            
            _resetSelection();
        }
        
        public override void Cancel()
        {
            // throw new NotImplementedException();
        }

        private void _resetSelection()
        {
            if (_selectTarget == null) return;

            // _highlightTarget(_selectTarget.Cell, false);
            _selectTarget = null;
        }
    }
}