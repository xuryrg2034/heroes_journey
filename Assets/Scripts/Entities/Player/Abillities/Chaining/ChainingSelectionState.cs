﻿using System;
using System.Collections.Generic;
using System.Linq;
using Core;
using UnityEngine;
using UnityEngine.UIElements;

namespace Entities.Player
{
    public class ChainingSelectionState : State
    {
        private ChainingAbility _ability;
        private List<BaseEntity> _selectedEntities;
        private bool _selectionLocked;

        public ChainingSelectionState(ChainingAbility ability)
        {
            _ability = ability;
            
            _selectedEntities = _ability.SelectedEntities;
        }

        public override void OnUpdate()
        {
            base.OnUpdate();

            if (Input.GetMouseButtonDown(0))
            {
                var mousePosition = Camera.main.ScreenToWorldPoint(Input.mousePosition);

                var hit = Physics2D.OverlapPoint(mousePosition, _ability.TilemapLayer);
                var entity = hit?.GetComponent<BaseEntity>();

                if (entity != null)
                {
                    _selectEntity(entity);
                }
            }
        }

        public override void OnEnter(StateMachine stateMachine)
        {
            base.OnEnter(stateMachine);
            
            _ability.ResetSelection();
        }

        private void _selectEntity(BaseEntity entity)
        {
            // Проверка, что бы нельзя было добавить в цепочку противка у которого больше 0 здоровья, когда нет урона
            if (entity.Health.Value > 0 && _ability.TotalDamage <= 0) return;

            // Клик произошел в начальную точку (героя)
            // Сбрасываем все к дефолту
            if (entity.GridPosition == _ability.OriginGridPosition)
            {
                _ability.ResetSelection();
                return;
            }

            // Клик произошел в сущность, что уже добавлена в список.
            // Удаляем все элементы из списка, что идут после этой сущности
            if (_selectedEntities.Contains(entity))
            {
                _removeEnemiesAfter(entity);
                _recalculateTotalDamage();
                
                return;
            }

            var originPosition = _selectedEntities.Count > 0 ? _selectedEntities.Last().GridPosition : _ability.OriginGridPosition;
            var isInRange = _isInRange(originPosition, entity.GridPosition);
            var canSelection = _canSelectionTypeByType(entity.SelectionType);
            
            if (!isInRange || !canSelection || _selectionLocked) return;
            
            _ability.SelectEntity(entity);
        }

        private void _removeEnemiesAfter(BaseEntity target)
        {
            var index = _selectedEntities.IndexOf(target);

            _ability.RemoveAtIndex(index);
        }

        private void _recalculateTotalDamage()
        {
            var totalDamage = _selectedEntities.Sum(item =>
            {
                if (item.Health.Value == 0)
                {
                    return 1;
                }

                return -item.Health.Value;
            });

            _ability.SetTotalDamage(totalDamage);
            _selectionLocked = totalDamage < 0;
        }
        
        private bool _canSelectionTypeByType(EntitySelectionType type)
        {
            if (
                type == EntitySelectionType.Neutral
                || _ability.AvailableType == EntitySelectionType.Neutral
            ) return true;

            return type == _ability.AvailableType;
        }
        
        private bool _isInRange(Vector3Int origin, Vector3Int target)
        {
            // Вычисляем разницу по X и Y
            var deltaX = Math.Abs(origin.x - target.x);
            var deltaY = Math.Abs(origin.y - target.y);

            return (deltaX == 1 && deltaY == 0) || (deltaX == 0 && deltaY == 1);
        }
    }
}