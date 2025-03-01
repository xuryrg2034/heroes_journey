using System;
using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Services.Selection;
using UnityEngine;

namespace Abilities.Hero
{
    [Serializable]
    public class ChainingAttack : BaseAbility
    {
        private readonly List<Entity> _selectedEntities = new();

        private Sequence _executeSequence;

        private EntitySelectionType _availableSelectionType = EntitySelectionType.Neutral;

        private int _totalDamage;
        
        private bool _selectionLocked;
        
        public override void Activate()
        {
            base.Activate();

            EntityClickHandler.OnEntityClicked += SelectTarget;
        }
        

        public override void Deactivate()
        {
            base.Deactivate();

            EntityClickHandler.OnEntityClicked -= SelectTarget;
            
            _resetSelection();
        }
        
        public override void SelectTarget(Entity entity)
        {
            if (entity == Hero)
            {
                _resetSelection();
                _totalDamage = 0;
                _updateHeroPower();
                return;
            }

            if (_selectedEntities.Contains(entity))
            {
                _removeEnemiesAfter(entity);
                _totalDamage = _selectedEntities.Sum(item =>
                {
                    if (item.Health.Value == 0)
                    {
                        return 1;
                    }

                    return -item.Health.Value;
                });

                _selectionLocked = _totalDamage < 0;
                _updateHeroPower();
                return;
            }

            var originPosition = _selectedEntities.Count > 0 ? _selectedEntities.Last().Cell.Position : Hero.Cell.Position;
            var isInRange = _isInRange(originPosition, entity.Cell.Position, 1);
            var canSelection = _canSelectionTypeByType(entity);
            
            if (!isInRange || !canSelection || _selectionLocked) return;
            
            // Проверка, что бы нельзя было добавить в цепочку противка у которого больше 0 здоровья, когда нет урона
            if (entity.Health.Value > 0 && _totalDamage <= 0) return;
            
            _selectedEntities.Add(entity);
            _availableSelectionType = entity.SelectionType;
            _highlightTarget(entity.Cell, true);

            if (entity.Health.Value == 0)
            {
                _totalDamage += 1;
                _selectionLocked = false;
            }
            else
            {
                _totalDamage -= entity.Health.Value;
                _selectionLocked = _totalDamage < 0;
            }

            _updateHeroPower();
        }

        public override async UniTask Execute()
        {
            await base.Execute();

            var damage = 0;
            foreach (var entity in _selectedEntities)
            {
                if (entity.Health.Value == 0)
                {
                    damage += 1;
                }
                else
                {
                    damage -= entity.Health.Value;
                }

                damage = damage < 0 ? 1 : damage;

                await entity.Health.TakeDamage(damage);

                if (entity.Health.IsDead)
                {
                    await Hero.Move(entity.Cell, 0.2f); 
                }
                _highlightTarget(entity.Cell, false);
            }

            _resetSelection();
        }

        public override void Cancel()
        {
            _executeSequence?.Kill();
            _resetSelection();
        }

        private bool _canSelectionTypeByType(Entity entity)
        {
            if (
                entity.SelectionType == EntitySelectionType.Neutral
                || _availableSelectionType == EntitySelectionType.Neutral
            ) return true;

            return entity.SelectionType == _availableSelectionType;
        }
        
        private void _removeEnemiesAfter(Entity target)
        {
            var index = _selectedEntities.IndexOf(target);
            if (index < 0) return;

            for (var i = _selectedEntities.Count - 1; i > index; i--)
            {
                _highlightTarget(_selectedEntities[i].Cell, false);
                _selectedEntities.RemoveAt(i);
            }
            
            _availableSelectionType = _selectedEntities.Last().SelectionType;
        }
        
        private void _resetSelection()
        {
            foreach (var entity in _selectedEntities)
            {
                _highlightTarget(entity.Cell, false);
            }

            _selectedEntities.Clear();
            _availableSelectionType = EntitySelectionType.Neutral;
            _selectionLocked = false;

            _totalDamage = 0;
            _updateHeroPower();
        }

        private void _updateHeroPower()
        {
            Hero.Damage.SetValue(_totalDamage < 0 ? 0 : _totalDamage);;
        }
    }
}